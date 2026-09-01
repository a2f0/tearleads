import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  containerKeyEpochs,
  containerKeyWraps,
} from "@tearleads/api-shared/schema";
import type { ContainerKekKeyring } from "@tearleads/crypto";
import {
  CONTAINER_KEK_LOG_PRINCIPAL_SCOPE_LIMIT,
  CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT,
} from "@tearleads/validators/util";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type {
  StoredContainerKeyEpoch,
  StoredContainerKeyWrap,
} from "./containerKekStoreRecords";
import {
  toStoredContainerKeyEpoch,
  toStoredContainerKeyWrap,
} from "./containerKekStoreRecords";

/**
 * Every epoch column except the sealed keyring. The keyring is O(its epoch)
 * bytes, so hot paths — projections, target checks, current-epoch lookups —
 * must never select it; `getContainerKeyEpochKeyring` is the sole reader.
 */
export const EPOCH_COLUMNS_WITHOUT_KEYRING = {
  accessManifestHash: containerKeyEpochs.accessManifestHash,
  containerId: containerKeyEpochs.containerId,
  createdAt: containerKeyEpochs.createdAt,
  createdByEventHash: containerKeyEpochs.createdByEventHash,
  createdByManifestHash: containerKeyEpochs.createdByManifestHash,
  id: containerKeyEpochs.id,
  keyEpoch: containerKeyEpochs.keyEpoch,
  keyringIv: sql<null>`null`,
  parentContainerKeyEpochId: containerKeyEpochs.parentContainerKeyEpochId,
  predecessorBridgeIv: containerKeyEpochs.predecessorBridgeIv,
  predecessorBridgeSuite: containerKeyEpochs.predecessorBridgeSuite,
  predecessorBridgeVersion: containerKeyEpochs.predecessorBridgeVersion,
  predecessorContainerKeyEpochId:
    containerKeyEpochs.predecessorContainerKeyEpochId,
  sealedKeyring: sql<null>`null`,
  wrappedPredecessorKey: containerKeyEpochs.wrappedPredecessorKey,
} as const;

/** Reads one epoch's sealed keyring — the only place the blob is selected. */
export async function getContainerKeyEpochKeyring(
  containerKeyEpochId: string,
  executor: DatabaseSession,
): Promise<ContainerKekKeyring | null> {
  const [row] = await executor
    .select()
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.id, containerKeyEpochId))
    .limit(1);
  return row ? toStoredContainerKeyEpoch(row).keyring : null;
}

/**
 * One bounded page of a container's epochs, selected in SQL. Keyring blobs
 * are the expensive column — each is O(its epoch) bytes — so they load only
 * when asked for. Fetches `limit + 1` rows to report whether more remain
 * without a second query.
 */
export async function listContainerKeyEpochPage(
  input: {
    readonly afterKeyEpoch: number;
    readonly containerId: string;
    readonly limit: number;
  },
  executor: DatabaseSession,
): Promise<{
  readonly epochs: StoredContainerKeyEpoch[];
  readonly hasMore: boolean;
}> {
  const rows = await executor
    .select(EPOCH_COLUMNS_WITHOUT_KEYRING)
    .from(containerKeyEpochs)
    .where(
      and(
        eq(containerKeyEpochs.containerId, input.containerId),
        gt(containerKeyEpochs.keyEpoch, input.afterKeyEpoch),
      ),
    )
    .orderBy(asc(containerKeyEpochs.keyEpoch))
    .limit(input.limit + 1);

  return {
    epochs: rows.slice(0, input.limit).map(toStoredContainerKeyEpoch),
    hasMore: rows.length > input.limit,
  };
}

/**
 * The ids of the envelopes this requester could use as anchors, at most
 * `CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT` per epoch, chosen in SQL.
 *
 * ONE bounded statement does the whole job. The window ranks each epoch's
 * envelopes independently, so no epoch can be starved by another's width, and
 * the rank is TOTALLY ORDERED — the requester's own direct wrap first, then
 * kind, recipient, and recipient key epoch — so the cut is deterministic and
 * the anchor openable without principal-policy state always survives it.
 * Recovery only ever needs one usable anchor per epoch, so a per-epoch cap
 * costs nothing it could have used.
 *
 * With the caller's epoch page bounded too, the row count is bounded by
 * page x cap, which is what keeps the response and the follow-up `IN` list
 * from growing with membership. Returning ids keeps the typed row mapping on
 * the regular Drizzle select; only one scalar column crosses the raw-SQL
 * boundary.
 */
async function selectQuotaLimitedWrapIds(
  containerKeyEpochIds: readonly string[],
  scope: ContainerKekRecipientScope,
  executor: DatabaseSession,
): Promise<string[]> {
  const scopeFilter = buildWrapScopeFilter(scope);
  if (!scopeFilter) {
    return [];
  }

  const result = await executor.execute(sql`
    select id from (
      select
        ${containerKeyWraps.id} as id,
        row_number() over (
          partition by ${containerKeyWraps.containerKeyEpochId}
          order by
            -- The requester's OWN envelope ranks first, always: it is the one
            -- anchor that needs no principal-policy state to open. Ordering by
            -- kind alone would sort 'user' last of the four and spend the cap
            -- on principal wraps, reporting a recoverable epoch as unreachable.
            case when ${containerKeyWraps.recipientKind} = 'user' then 0 else 1 end,
            ${containerKeyWraps.recipientKind},
            ${containerKeyWraps.recipientId},
            ${containerKeyWraps.recipientKeyEpochId}
        ) as epoch_rank
      from ${containerKeyWraps}
      where ${containerKeyWraps.containerKeyEpochId} in (${sql.join(
        containerKeyEpochIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        and ${scopeFilter}
    ) ranked
    where ranked.epoch_rank <= ${CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT}
  `);

  const rows: unknown = Array.isArray(result) ? result : result.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Container key wrap id query returned no row set");
  }
  return rows.map((row) => {
    const id: unknown = Reflect.get(Object(row), "id");
    if (typeof id !== "string") {
      throw new Error("Container key wrap id is not a string");
    }
    return id;
  });
}

interface ContainerKekRecipientScope {
  readonly authorizedPrincipals: readonly {
    readonly principalId: string;
    readonly principalType: "group";
  }[];
  readonly parentContainerIds: readonly string[];
  readonly userId: string;
}

/**
 * The SQL predicate selecting the envelopes this requester could open: their
 * own direct wrap, their parent-container wraps, and the principals that
 * authorize them.
 *
 * The principal list is capped because a requester's principal set has no
 * intrinsic ceiling and each entry adds a clause — and bind parameters — to
 * the statement. The direct-user and parent-container clauses sit OUTSIDE that
 * cap and the ranking below puts the direct wrap first, so the anchors
 * openable without any principal-policy state are never the ones the cap
 * costs. (Opening a principal wrap needs historical policy state regardless —
 * see issue #1941.)
 */
function buildWrapScopeFilter(
  scope: ContainerKekRecipientScope,
): SQL | undefined {
  return or(
    scope.parentContainerIds.length > 0
      ? and(
          eq(containerKeyWraps.recipientKind, "container"),
          inArray(containerKeyWraps.recipientId, [...scope.parentContainerIds]),
        )
      : undefined,
    and(
      eq(containerKeyWraps.recipientKind, "user"),
      eq(containerKeyWraps.recipientId, scope.userId),
    ),
    // Preserve (kind, id) identity even though container principal grants are
    // currently group-only.
    ...scope.authorizedPrincipals
      .slice(0, CONTAINER_KEK_LOG_PRINCIPAL_SCOPE_LIMIT)
      .map((principal) =>
        and(
          eq(containerKeyWraps.recipientKind, principal.principalType),
          eq(containerKeyWraps.recipientId, principal.principalId),
        ),
      ),
  );
}

export async function listContainerKeyWrapsByEpochId(
  containerKeyEpochIds: readonly string[],
  executor: DatabaseSession,
  /**
   * Recipient scope, applied in SQL. Recovery reads pass it so a page never
   * materializes every member's envelopes only to filter them in memory.
   */
  recipientScope?: ContainerKekRecipientScope | undefined,
): Promise<Map<string, StoredContainerKeyWrap[]>> {
  const uniqueIds = [...new Set(containerKeyEpochIds)];
  const wrapsByEpochId = new Map<string, StoredContainerKeyWrap[]>(
    uniqueIds.map((id) => [id, []]),
  );
  if (uniqueIds.length === 0) {
    return wrapsByEpochId;
  }

  const scopedIds = recipientScope
    ? await selectQuotaLimitedWrapIds(uniqueIds, recipientScope, executor)
    : null;
  if (scopedIds && scopedIds.length === 0) {
    return wrapsByEpochId;
  }

  const rows = await executor
    .select()
    .from(containerKeyWraps)
    .where(
      scopedIds
        ? inArray(containerKeyWraps.id, scopedIds)
        : inArray(containerKeyWraps.containerKeyEpochId, uniqueIds),
    )
    .orderBy(
      asc(containerKeyWraps.containerKeyEpochId),
      asc(containerKeyWraps.recipientKind),
      asc(containerKeyWraps.recipientId),
      asc(containerKeyWraps.recipientKeyEpochId),
    );

  for (const row of rows) {
    wrapsByEpochId
      .get(row.containerKeyEpochId)
      ?.push(toStoredContainerKeyWrap(row));
  }
  return wrapsByEpochId;
}

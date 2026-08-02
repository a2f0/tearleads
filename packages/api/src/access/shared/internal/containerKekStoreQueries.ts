import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  containerKeyEpochs,
  containerKeyWraps,
} from "@tearleads/api-shared/schema";
import type { ContainerKekKeyring } from "@tearleads/crypto";
import {
  CONTAINER_KEK_LOG_PRINCIPAL_SCOPE_LIMIT,
  CONTAINER_KEK_WRAPS_PER_RECIPIENT_LIMIT,
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
 * The ids of the scoped wraps, at most
 * `CONTAINER_KEK_WRAPS_PER_RECIPIENT_LIMIT` per (epoch, recipient), chosen in
 * SQL by a windowed rank so no epoch and no recipient can consume another's
 * share. Returning ids keeps the typed row mapping on the regular Drizzle
 * select; only two scalar columns cross the raw-SQL boundary.
 */
async function selectQuotaLimitedWrapIds(
  containerKeyEpochIds: readonly string[],
  scopeFilter: SQL,
  executor: DatabaseSession,
): Promise<string[]> {
  const result = await executor.execute(sql`
    select id from (
      select
        ${containerKeyWraps.id} as id,
        row_number() over (
          -- Partition per RECIPIENT, not merely per epoch. Every recipient the
          -- scope filter admits is one this requester is authorized through,
          -- so each gets its own quota and none can be crowded out by another.
          -- The response therefore scales with the requester's own
          -- authorization breadth rather than with the container's total
          -- membership, and no reachable anchor is ever dropped — which a
          -- single per-epoch quota could not promise once a requester holds
          -- more principals than the quota.
          partition by
            ${containerKeyWraps.containerKeyEpochId},
            ${containerKeyWraps.recipientKind},
            ${containerKeyWraps.recipientId}
          -- The requester's OWN envelope first: it needs no principal-policy
          -- state to open, so it is the anchor most likely to be usable.
          order by
            case when ${containerKeyWraps.recipientKind} = 'user' then 0 else 1 end,
            ${containerKeyWraps.recipientKeyEpochId}
        ) as recipient_rank
      from ${containerKeyWraps}
      where ${containerKeyWraps.containerKeyEpochId} in (${sql.join(
        containerKeyEpochIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        and ${scopeFilter}
    ) ranked
    where ranked.recipient_rank <= ${CONTAINER_KEK_WRAPS_PER_RECIPIENT_LIMIT}
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

export async function listContainerKeyWrapsByEpochId(
  containerKeyEpochIds: readonly string[],
  executor: DatabaseSession,
  /**
   * Recipient scope, applied in SQL. Recovery reads pass it so a page never
   * materializes every member's envelopes only to filter them in memory.
   */
  recipientScope?:
    | {
        readonly authorizedPrincipals: readonly {
          readonly principalId: string;
          readonly principalType: "group" | "organization";
        }[];
        readonly parentContainerIds: readonly string[];
        readonly userId: string;
      }
    | undefined,
): Promise<Map<string, StoredContainerKeyWrap[]>> {
  const uniqueIds = [...new Set(containerKeyEpochIds)];
  const wrapsByEpochId = new Map<string, StoredContainerKeyWrap[]>(
    uniqueIds.map((id) => [id, []]),
  );
  if (uniqueIds.length === 0) {
    return wrapsByEpochId;
  }

  const scopeFilter = recipientScope
    ? or(
        recipientScope.parentContainerIds.length > 0
          ? and(
              eq(containerKeyWraps.recipientKind, "container"),
              inArray(containerKeyWraps.recipientId, [
                ...recipientScope.parentContainerIds,
              ]),
            )
          : undefined,
        and(
          eq(containerKeyWraps.recipientKind, "user"),
          eq(containerKeyWraps.recipientId, recipientScope.userId),
        ),
        // (kind, id) identity: a group and an organization may share an id,
        // and only the exact principal that authorizes this requester counts.
        //
        // Bounded because a requester's principal set has no intrinsic ceiling:
        // one clause per principal would grow the statement — and its bind
        // parameters — without limit, and the per-recipient quota below bounds
        // only what each partition returns, not how many partitions exist. The
        // direct-user and parent-container clauses sit outside this cap, so
        // the anchors that need no principal-policy state are never the ones
        // dropped.
        ...recipientScope.authorizedPrincipals
          .slice(0, CONTAINER_KEK_LOG_PRINCIPAL_SCOPE_LIMIT)
          .map((principal) =>
            and(
              eq(containerKeyWraps.recipientKind, principal.principalType),
              eq(containerKeyWraps.recipientId, principal.principalId),
            ),
          ),
      )
    : undefined;

  // A page's epochs can each carry many recipients, so a recovery read must be
  // bounded or a wide container could answer with hundreds of megabytes. The
  // scope filter already narrows to recipients this requester is authorized
  // through, and the quota below is per (epoch, recipient), so the bound never
  // costs a reachable anchor: a dropped anchor is indistinguishable from an
  // unaddressed epoch and would surface as a false `no-addressed-envelope`
  // recovery failure.
  const scopedIds = scopeFilter
    ? await selectQuotaLimitedWrapIds(uniqueIds, scopeFilter, executor)
    : null;
  if (scopedIds?.length === 0) {
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

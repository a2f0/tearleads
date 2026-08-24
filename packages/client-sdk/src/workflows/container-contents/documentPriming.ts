import {
  documentContainerProjectionTables,
  documentMoveIntentTables,
  documentProjectionTables,
  documentTables,
} from "../../data/sqlite/schema";
import { ensureSqlTables } from "../../data/sqlite/sqlSchema";
import type {
  ContainerContentsContainerSubtreeState,
  ContainerContentsDocumentRuntimeTarget,
  ContainerDocumentPrimeHost,
  ContainerDocumentQueriesRuntime,
} from "./documentQueries/types";
import { requestDocumentRuntimeTargetSync } from "./documentRuntimeTargetSync";
import { listDocumentRuntimeTargetsForContainerSubtreeFromRuntime } from "./documentSubtreeQueries";
import {
  getOrphanedDocumentQueryBind,
  getOrphanedDocumentWhereSql,
} from "./orphanedDocumentSql";

interface PrimeRequiredDocumentCandidate {
  readonly localId: string;
}

interface LoadedRootDocumentPrimeResult {
  readonly candidateCount: number;
  readonly orphanPrimedCount: number;
  readonly primedCount: number;
  readonly rootCount: number;
  readonly unroutableCount: number;
}

// Documents that still NEED a store opened at prime time: local-only creates,
// queued outbound updates/attachments, an outgoing-delta marker behind the
// stored content frontier (a deferred tail; encoding inequality
// over-approximates, which only re-primes a store the old behavior always
// primed), a never-hydrated document (a freshly discovered share whose
// content pull the primed lane performs), or a document with a recorded sync
// failure (a refused revalidation leaves no queued work, so the failure row
// is the only ticket that re-drives the store — the retry that clears on the
// next clean pass). Fully-synced hydrated documents are
// deliberately absent: priming exists to re-drive durable work, and opening a
// store per settled document is what made a 1000-document boot a storm.
const PENDING_PRIME_LOCAL_ID_SQL = `
  SELECT stored.local_id AS local_id
  FROM documents stored
  WHERE stored.app_kind = 'documents'
    AND (
      stored.document_id IS NULL
      OR stored.snapshot_end_version = ''
      OR stored.pull_continuation IS NOT NULL
      OR COALESCE(stored.pending_base_version, '') <> stored.snapshot_end_version
      OR EXISTS (
        SELECT 1
        FROM document_pending_updates pending
        WHERE pending.app_kind = 'documents'
          AND pending.local_id = stored.local_id
      )
      OR EXISTS (
        SELECT 1
        FROM document_sync_failures failure
        WHERE failure.app_kind = 'documents'
          AND failure.local_id = stored.local_id
      )
      OR EXISTS (
        SELECT 1
        FROM document_pending_attachments attachment
        WHERE attachment.local_id = stored.local_id
      )
    )
`;

const PENDING_PRIME_DOCUMENT_CANDIDATE_SQL = `
  SELECT pending.local_id AS local_id
  FROM (${PENDING_PRIME_LOCAL_ID_SQL}) pending
  ORDER BY pending.local_id ASC
`;

// The structural startup probe and the priming worker share the same durable
// predicate so they cannot disagree about what counts as document work.
const STARTUP_DOCUMENT_SYNC_WORK_SQL = `
  SELECT 1 AS present
  WHERE EXISTS (${PENDING_PRIME_LOCAL_ID_SQL})
    OR EXISTS (
      SELECT 1
      FROM document_move_intents intent
      -- Blocked and parked denied moves count: blocked intents replay on
      -- every scan (the blocking condition can heal after hydration), and
      -- the once-per-launch replay makes denied moves retriable — so a
      -- relaunch whose only durable work is either kind must still schedule
      -- the structural pass that re-attempts it (row 7).
      WHERE intent.sync_status IN ('pending', 'blocked', 'denied')
    )
  LIMIT 1
`;

export async function hasStartupDocumentSyncWork(
  runtimeOrExecSql:
    | ContainerDocumentQueriesRuntime
    | ContainerDocumentQueriesRuntime["infra"]["execSql"],
): Promise<boolean> {
  const execSql =
    typeof runtimeOrExecSql === "function"
      ? runtimeOrExecSql
      : runtimeOrExecSql.infra.execSql;
  await ensureSqlTables(execSql, [
    ...documentTables,
    ...documentProjectionTables,
    ...documentMoveIntentTables,
  ]);
  const rows = await execSql(STARTUP_DOCUMENT_SYNC_WORK_SQL);
  return rows.length > 0;
}

async function listPrimeRequiredDocumentCandidatesFromRuntime(
  runtime: ContainerDocumentQueriesRuntime,
): Promise<PrimeRequiredDocumentCandidate[]> {
  await ensureSqlTables(runtime.infra.execSql, [
    ...documentTables,
    ...documentProjectionTables,
  ]);
  const rows = await runtime.infra.execSql(
    PENDING_PRIME_DOCUMENT_CANDIDATE_SQL,
  );

  return rows.flatMap((row) => {
    const localId = Reflect.get(row, "local_id");
    if (typeof localId !== "string") {
      return [];
    }
    return [{ localId }];
  });
}

// A row with content but a NULL outgoing-delta marker is deliberately treated
// as unsettled: the store persist path always sets the marker, so over-priming
// is the safe direction.
async function listPrimeRequiredLocalIdsFromRuntime(
  runtime: ContainerDocumentQueriesRuntime,
): Promise<ReadonlySet<string>> {
  const candidates =
    await listPrimeRequiredDocumentCandidatesFromRuntime(runtime);
  return new Set(candidates.map((candidate) => candidate.localId));
}

/**
 * Last-link orphans (docs/sync-edge-cases.md row 3): the container cascade
 * nulled their projection container and dropped their link rows, so no
 * subtree listing can route them. They are primed with a null container
 * scope instead — the documents runtime accepts one, and the document's own
 * sync pass then resolves its fate against the server: 403 parks it (row 8),
 * a coded 404 destroys it (row 1), and a local-only orphan's create attempt
 * records a terminal failure row. Hidden document kinds stay excluded, and
 * dangling non-null projections (a container row merely missing locally)
 * stay with stale-root recovery, exactly as before.
 *
 * Organization neutrality: the null scope changes only the runtime's
 * containerId — auth, crypto, and organization plumbing are identical to
 * every container-scoped runtime this store already primes with, the sync
 * pass derives billing and keying organizations from the document's own
 * plan and manifest, and a cross-organization author fails closed at the
 * sync layer's identity guard before anything is signed.
 */
const ORPHANED_PRIME_TARGET_SQL = `
  SELECT stored.local_id AS local_id, stored.document_id AS document_id
  FROM documents stored
  INNER JOIN document_projection projection
    ON projection.local_id = stored.local_id
  WHERE stored.app_kind = 'documents'
    AND ${getOrphanedDocumentWhereSql({
      documentIdSql: "stored.document_id",
      projectionAlias: "projection",
    })}
  ORDER BY stored.local_id ASC
`;

/**
 * Unattributed rows (empty/NULL organization) are always included: they are
 * device-first documents created before authentication, which belong to this
 * device's sole user and adopt the active organization when they create.
 */
async function listOrphanedDocumentPrimeTargets(
  runtime: ContainerDocumentQueriesRuntime,
  organizationId: string,
): Promise<ContainerContentsDocumentRuntimeTarget[]> {
  await ensureSqlTables(runtime.infra.execSql, [
    ...documentTables,
    ...documentProjectionTables,
    ...documentContainerProjectionTables,
  ]);
  const rows = await runtime.infra.execSql(
    ORPHANED_PRIME_TARGET_SQL,
    getOrphanedDocumentQueryBind(organizationId),
  );
  return rows.flatMap((row) => {
    const localId = Reflect.get(row, "local_id");
    if (typeof localId !== "string") {
      return [];
    }
    const documentId = Reflect.get(row, "document_id");
    return [
      {
        documentId: typeof documentId === "string" ? documentId : null,
        localId,
        runtimeContainerId: null,
      },
    ];
  });
}

export async function primeDocumentsForContainerSubtree<TRuntime>(input: {
  containersById: ReadonlyMap<string, ContainerContentsContainerSubtreeState>;
  host: ContainerDocumentPrimeHost<TRuntime>;
  primeRequiredLocalIds?: ReadonlySet<string>;
  rootContainerId: string;
  runtime: ContainerDocumentQueriesRuntime;
}): Promise<number> {
  const [targets, primeRequiredLocalIds] = await Promise.all([
    listDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
      containersById: input.containersById,
      rootContainerId: input.rootContainerId,
      runtime: input.runtime,
    }),
    input.primeRequiredLocalIds ??
      listPrimeRequiredLocalIdsFromRuntime(input.runtime),
  ]);
  const primed = await requestDocumentRuntimeTargetSync({
    host: input.host,
    targets: targets.filter((target) =>
      primeRequiredLocalIds.has(target.localId),
    ),
  });
  return primed.size;
}

export async function primeDocumentsForLoadedRoots<TRuntime>(input: {
  containersById: ReadonlyMap<string, ContainerContentsContainerSubtreeState>;
  host: ContainerDocumentPrimeHost<TRuntime>;
  /**
   * The store scope's organization. Orphan priming is bounded to it: each
   * organization-scoped store resolves only its own orphans, matching the
   * per-organization invariant subtree routing provides implicitly (a pass
   * signed under another organization would fail the sync identity guard
   * instead of resolving). Absent — unauthenticated or scope-less callers —
   * orphan priming is skipped entirely.
   */
  organizationId?: string | null;
  runtime: ContainerDocumentQueriesRuntime;
}): Promise<LoadedRootDocumentPrimeResult> {
  const candidates = await listPrimeRequiredDocumentCandidatesFromRuntime(
    input.runtime,
  );
  const rootContainerIds = Array.from(input.containersById.values()).flatMap(
    (containerState) =>
      containerState.container.parentId === null
        ? [containerState.container.id]
        : [],
  );
  const requiredLocalIds = new Set(
    candidates.map((candidate) => candidate.localId),
  );
  const primedLocalIds = new Set<string>();

  for (const rootContainerId of rootContainerIds) {
    const targets =
      await listDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
        containersById: input.containersById,
        rootContainerId,
        runtime: input.runtime,
      });
    const primed = await requestDocumentRuntimeTargetSync({
      host: input.host,
      targets: targets.filter(
        (target) =>
          requiredLocalIds.has(target.localId) &&
          !primedLocalIds.has(target.localId),
      ),
    });
    for (const localId of primed) {
      primedLocalIds.add(localId);
    }
  }

  const orphanTargets = (
    input.organizationId
      ? await listOrphanedDocumentPrimeTargets(
          input.runtime,
          input.organizationId,
        )
      : []
  ).filter(
    (target) =>
      requiredLocalIds.has(target.localId) &&
      !primedLocalIds.has(target.localId),
  );
  const orphanPrimed = await requestDocumentRuntimeTargetSync({
    host: input.host,
    targets: orphanTargets,
  });
  for (const localId of orphanPrimed) {
    primedLocalIds.add(localId);
  }

  return {
    candidateCount: candidates.length,
    orphanPrimedCount: orphanPrimed.size,
    primedCount: primedLocalIds.size,
    rootCount: rootContainerIds.length,
    unroutableCount: candidates.filter(
      (candidate) => !primedLocalIds.has(candidate.localId),
    ).length,
  };
}

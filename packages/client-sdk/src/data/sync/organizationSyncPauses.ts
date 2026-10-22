import type { DomainScope } from "../shared/domainScope";
import {
  organizationSyncPauses,
  organizationSyncPauseTables,
} from "../sqlite/schema/organizationSyncPauseSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../sqlite/sqlSchema";

/** The container fields the pause rule reads. */
export interface OrganizationSyncPauseSubject {
  readonly organizationId: string;
  readonly parentId: string | null;
  readonly systemSlot?: string | null | undefined;
}

/**
 * Whether a container stays on the device while its organization is paused:
 * only the organization's parentless system root, the metadata root every
 * Members recipient reads, which keeps the organization named and its
 * membership visible.
 */
export function isRetainedWhileSyncPaused(
  container: OrganizationSyncPauseSubject,
): boolean {
  return container.parentId === null && Boolean(container.systemSlot);
}

export interface OrganizationSyncPauseChange {
  readonly paused: readonly string[];
  readonly resumed: readonly string[];
}

/**
 * Which organizations this user paused syncing to their devices, for one
 * domain scope. Sync reads it synchronously once `load` has settled; the
 * persisted set lets a device that starts offline keep honoring a pause.
 */
export interface OrganizationSyncPauses {
  /** Loads the persisted set once; concurrent and later calls share it. */
  load(execSql: ExecSql): Promise<void>;
  isOrganizationPaused(organizationId: string): boolean;
  /**
   * Whether sync skips this container: every container of a paused
   * organization except the one `isRetainedWhileSyncPaused` keeps. The
   * session's active organization is never skipped, even when paused from
   * another device: its root is the session's workspace until it switches
   * away.
   */
  isContainerPaused(
    container: OrganizationSyncPauseSubject,
    activeOrganizationId: string | null,
  ): boolean;
  pausedOrganizationIds(): ReadonlySet<string>;
  /**
   * Records documents of a paused organization that cleanup kept because an
   * open store held them. Their stores stop pulling remote changes and only
   * upload what they still hold; resuming the organization releases them.
   */
  holdDocuments(organizationId: string, localIds: readonly string[]): void;
  /** Forgets held documents that cleanup has since removed. */
  releaseDocuments(localIds: readonly string[]): void;
  isDocumentHeld(localId: string): boolean;
  /** Persists exactly this set and reports which organizations changed. */
  replace(
    execSql: ExecSql,
    organizationIds: Iterable<string>,
  ): Promise<OrganizationSyncPauseChange>;
  subscribe(listener: () => void): () => void;
  /**
   * Runs membership work for this scope one task at a time, so a membership
   * read that started before a pause or resume cannot apply after it.
   * Re-entrant calls from inside a task would wait on themselves.
   */
  runExclusive<T>(task: () => Promise<T>): Promise<T>;
}

async function readPausedOrganizationIds(
  execSql: ExecSql,
): Promise<Set<string>> {
  await ensureSqlTables(execSql, organizationSyncPauseTables);
  const rows = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({ organizationId: organizationSyncPauses.organizationId })
    .from(organizationSyncPauses);
  return new Set(rows.map((row) => row.organizationId));
}

async function writePausedOrganizationIds(
  execSql: ExecSql,
  organizationIds: ReadonlySet<string>,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureSqlTables(lockedExecSql, organizationSyncPauseTables);
    const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
    await db.delete(organizationSyncPauses).run();
    if (organizationIds.size > 0) {
      await db
        .insert(organizationSyncPauses)
        .values(
          [...organizationIds].map((organizationId) => ({ organizationId })),
        )
        .run();
    }
  });
}

function createOrganizationSyncPauses(): OrganizationSyncPauses {
  let paused: ReadonlySet<string> = new Set();
  let loading: Promise<void> | null = null;
  let replacing: Promise<void> = Promise.resolve();
  let exclusive: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const heldOrganizationByDocument = new Map<string, string>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const pauses: OrganizationSyncPauses = {
    load(execSql) {
      loading ??= readPausedOrganizationIds(execSql).then(
        (stored) => {
          paused = stored;
          if (stored.size > 0) notify();
        },
        (error: unknown) => {
          // Let a later call retry a failed read.
          loading = null;
          throw error;
        },
      );
      return loading;
    },
    isOrganizationPaused: (organizationId) => paused.has(organizationId),
    isContainerPaused: (container, activeOrganizationId) =>
      paused.has(container.organizationId) &&
      container.organizationId !== activeOrganizationId &&
      !isRetainedWhileSyncPaused(container),
    pausedOrganizationIds: () => paused,
    holdDocuments(organizationId, localIds) {
      for (const localId of localIds) {
        heldOrganizationByDocument.set(localId, organizationId);
      }
    },
    releaseDocuments(localIds) {
      for (const localId of localIds)
        heldOrganizationByDocument.delete(localId);
    },
    isDocumentHeld: (localId) => heldOrganizationByDocument.has(localId),
    replace(execSql, organizationIds) {
      const next = new Set(organizationIds);
      // Serialize replacements so each one diffs against the set the previous
      // one committed.
      const run = replacing.then(async () => {
        await pauses.load(execSql);
        const change = {
          paused: [...next].filter((id) => !paused.has(id)).sort(),
          resumed: [...paused].filter((id) => !next.has(id)).sort(),
        };
        if (change.paused.length === 0 && change.resumed.length === 0) {
          return change;
        }
        await writePausedOrganizationIds(execSql, next);
        paused = next;
        for (const [localId, organizationId] of heldOrganizationByDocument) {
          if (!next.has(organizationId)) {
            heldOrganizationByDocument.delete(localId);
          }
        }
        notify();
        return change;
      });
      replacing = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    runExclusive(task) {
      const run = exclusive.then(task);
      exclusive = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
  return pauses;
}

const pausesByScope = new WeakMap<DomainScope, OrganizationSyncPauses>();

/** The one pause set for a domain scope; a new scope starts unloaded. */
export function getOrCreateOrganizationSyncPauses(
  domainScope: DomainScope,
): OrganizationSyncPauses {
  let pauses = pausesByScope.get(domainScope);
  if (!pauses) {
    pauses = createOrganizationSyncPauses();
    pausesByScope.set(domainScope, pauses);
  }
  return pauses;
}

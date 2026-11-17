import type { DomainScope } from "../shared/domainScope";
import {
  organizationSyncPauses,
  organizationSyncPauseTables,
} from "../sqlite/schema/organizationSyncPauseSchema";
import { sqliteInsertBatchSize } from "../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../sqlite/sqlSchema";
import {
  organizationSyncPausesUnreadable,
  transitionOrganizationSyncPauseRead,
  UNREAD_ORGANIZATION_SYNC_PAUSES,
} from "./organizationSyncPauseReadMachine";
import { requestAllDomainSyncLanes } from "./syncCoordinator";

/** The container fields the pause rule reads. */
export interface OrganizationSyncPauseSubject {
  readonly organizationId: string;
  readonly parentId: string | null;
  readonly systemSlot?: string | null | undefined;
}

/**
 * Whether a container keeps listing while its organization is paused: only
 * the organization's parentless system root, the metadata root every Members
 * recipient reads, so a device that has never synced the organization still
 * lists it and can resume it. Its documents are held like any other once
 * pulled.
 */
function syncsWhileOrganizationPaused(
  container: OrganizationSyncPauseSubject,
): boolean {
  return container.parentId === null && Boolean(container.systemSlot);
}

export interface OrganizationSyncPauseChange {
  readonly paused: readonly string[];
  readonly resumed: readonly string[];
}

/**
 * Which organizations this user paused syncing on this device, for one domain
 * scope. Sync reads it synchronously once `load` has settled; the persisted
 * set lets a device that starts offline keep honoring a pause.
 */
export interface OrganizationSyncPauses {
  /** Loads the persisted set once; concurrent and later calls share it. */
  load(execSql: ExecSql): Promise<void>;
  isOrganizationPaused(organizationId: string): boolean;
  /**
   * Whether the organization's uploads and document pulls are held: it is
   * paused, or the last read of the persisted set failed. A device that
   * cannot read its pauses cannot tell which organizations to hold, so it
   * holds them all, leaving local edits queued, until a read succeeds.
   */
  holdsSync(organizationId: string): boolean;
  /**
   * Whether sync skips this container: every container of a paused
   * organization except its metadata root. The session's active organization
   * is held like any other; its content is already on the device.
   */
  isContainerPaused(container: OrganizationSyncPauseSubject): boolean;
  pausedOrganizationIds(): ReadonlySet<string>;
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

/** Persistence for organization sync pauses, bound to one executor. */
class OrganizationSyncPauseRepository {
  private readonly execSql: ExecSql;

  constructor(execSql: ExecSql) {
    this.execSql = execSql;
  }

  async readPausedOrganizationIds(): Promise<Set<string>> {
    await ensureSqlTables(this.execSql, organizationSyncPauseTables);
    const rows = await getClientSQLitePersistenceRuntime(this.execSql)
      .db.select({ organizationId: organizationSyncPauses.organizationId })
      .from(organizationSyncPauses);
    return new Set(rows.map((row) => row.organizationId));
  }

  // One transaction replaces the whole set, so a failed write keeps the
  // previous pauses in force; inserts go in batches within SQLite's bind
  // budget.
  async writePausedOrganizationIds(
    organizationIds: ReadonlySet<string>,
  ): Promise<void> {
    await runSerializedSqlMutation(this.execSql, async (lockedExecSql) => {
      await ensureSqlTables(lockedExecSql, organizationSyncPauseTables);
      const ids = [...organizationIds];
      const batchSize = sqliteInsertBatchSize(organizationSyncPauses);
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await tx.delete(organizationSyncPauses).run();
          for (let index = 0; index < ids.length; index += batchSize) {
            await tx
              .insert(organizationSyncPauses)
              .values(
                ids
                  .slice(index, index + batchSize)
                  .map((organizationId) => ({ organizationId })),
              )
              .run();
          }
        },
      );
    });
  }
}

function createOrganizationSyncPauses(
  domainScope: DomainScope,
): OrganizationSyncPauses {
  let paused: ReadonlySet<string> = new Set();
  let read = UNREAD_ORGANIZATION_SYNC_PAUSES;
  let replacing: Promise<void> = Promise.resolve();
  let exclusive: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const pauses: OrganizationSyncPauses = {
    load(execSql) {
      if (read.status === "reading" || read.status === "read") return read.read;
      const reading = new OrganizationSyncPauseRepository(execSql)
        .readPausedOrganizationIds()
        .then(
          (stored) => {
            paused = stored;
            const recovered = organizationSyncPausesUnreadable(read);
            read = transitionOrganizationSyncPauseRead(read, {
              type: "succeed",
            });
            // Writes held while the set could not be read left their lanes
            // idle, so every lane is re-driven.
            if (recovered) requestAllDomainSyncLanes(domainScope);
            if (stored.size > 0) notify();
          },
          (error: unknown) => {
            read = transitionOrganizationSyncPauseRead(read, { type: "fail" });
            throw error;
          },
        );
      read = transitionOrganizationSyncPauseRead(read, {
        read: reading,
        type: "start",
      });
      return reading;
    },
    isOrganizationPaused: (organizationId) => paused.has(organizationId),
    holdsSync: (organizationId) =>
      organizationSyncPausesUnreadable(read) || paused.has(organizationId),
    isContainerPaused: (container) =>
      paused.has(container.organizationId) &&
      !syncsWhileOrganizationPaused(container),
    pausedOrganizationIds: () => paused,
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
        await new OrganizationSyncPauseRepository(
          execSql,
        ).writePausedOrganizationIds(next);
        paused = next;
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

/**
 * Loads the scope's paused organizations before a store starts syncing, since
 * its sync lanes read them synchronously. A failed read is reported and never
 * keeps the store from starting: the store opens and takes local edits, and
 * every organization's sync stays held (see `holdsSync`) until a later read,
 * such as the one hydration and discovery make before they fetch, succeeds.
 */
export async function loadOrganizationSyncPausesBeforeSync(input: {
  readonly domainScope: DomainScope;
  readonly execSql: ExecSql;
  readonly log: (message: string) => void;
}): Promise<void> {
  try {
    await getOrCreateOrganizationSyncPauses(input.domainScope).load(
      input.execSql,
    );
  } catch {
    input.log("Sync: could not read the organization sync pauses");
  }
}

/** The one pause set for a domain scope; a new scope starts unloaded. */
export function getOrCreateOrganizationSyncPauses(
  domainScope: DomainScope,
): OrganizationSyncPauses {
  let pauses = pausesByScope.get(domainScope);
  if (!pauses) {
    pauses = createOrganizationSyncPauses(domainScope);
    pausesByScope.set(domainScope, pauses);
  }
  return pauses;
}

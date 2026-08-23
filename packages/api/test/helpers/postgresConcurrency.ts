import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import { db } from "@symcrypt/api-shared/postgres";
import { accessManifestHeads } from "@symcrypt/api-shared/schema";
import { and, eq, sql } from "drizzle-orm";

const LOCK_WAIT_TIMEOUT_MS = 10_000;

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

interface PostgresLockHandle {
  readonly backendPid: number;
  readonly release: () => Promise<void>;
}

export async function holdPostgresLock(
  acquire: (tx: DatabaseTransaction) => Promise<void>,
): Promise<PostgresLockHandle> {
  const acquired = deferred<number>();
  const release = deferred<void>();
  const completion = db.transaction(async (tx) => {
    const result = await tx.execute(sql`select pg_backend_pid() as pid`);
    const backendPid = Number(Reflect.get(result.rows[0] ?? {}, "pid"));
    if (!Number.isInteger(backendPid)) {
      throw new Error("Expected PostgreSQL backend pid");
    }
    await acquire(tx);
    acquired.resolve(backendPid);
    await release.promise;
  });
  void completion.catch(acquired.reject);

  return {
    backendPid: await acquired.promise,
    release: async () => {
      release.resolve();
      await completion;
    },
  };
}

export function holdAccessManifestHeadForUpdate(input: {
  readonly objectId: string;
  readonly objectKind: "blob" | "container" | "document";
}): Promise<PostgresLockHandle> {
  return holdPostgresLock(async (tx) => {
    await tx
      .select({ id: accessManifestHeads.id })
      .from(accessManifestHeads)
      .where(
        and(
          eq(accessManifestHeads.objectKind, input.objectKind),
          eq(accessManifestHeads.objectId, input.objectId),
        ),
      )
      .for("update");
  });
}

export async function waitForPostgresLockWait(input: {
  readonly blockerPid: number;
  readonly minimumWaiters?: number;
  readonly queryFragment: string;
}): Promise<void> {
  const minimumWaiters = input.minimumWaiters ?? 1;
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      with recursive blocked_pids(pid) as (
        select activity.pid
        from pg_stat_activity activity
        where activity.datname = current_database()
          and ${input.blockerPid} = any(pg_blocking_pids(activity.pid))
        union
        select activity.pid
        from pg_stat_activity activity
        join blocked_pids blocker
          on blocker.pid = any(pg_blocking_pids(activity.pid))
        where activity.datname = current_database()
      )
      select count(*)::integer as "waiting"
      from blocked_pids
      join pg_stat_activity activity using (pid)
      where activity.wait_event_type = 'Lock'
        and activity.query like ${`%${input.queryFragment}%`}
    `);
    const waiting = Number(Reflect.get(result.rows[0] ?? {}, "waiting"));
    if (waiting >= minimumWaiters) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error(
    `Timed out waiting for ${minimumWaiters} PostgreSQL lock waiter(s) behind backend ${input.blockerPid}: ${input.queryFragment}`,
  );
}

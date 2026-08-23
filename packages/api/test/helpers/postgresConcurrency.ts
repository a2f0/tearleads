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

async function holdPostgresLock(
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
  readonly minimumWaiters?: number;
  readonly queryFragment: string;
}): Promise<void> {
  const minimumWaiters = input.minimumWaiters ?? 1;
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      select count(*)::integer as "waiting"
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
        and query like ${`%${input.queryFragment}%`}
    `);
    const waiting = Number(Reflect.get(result.rows[0] ?? {}, "waiting"));
    if (waiting >= minimumWaiters) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error(
    `Timed out waiting for ${minimumWaiters} PostgreSQL lock waiter(s): ${input.queryFragment}`,
  );
}

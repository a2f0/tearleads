import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  localSchemaMigrations,
  localSchemaSteps,
} from "./localSchemaMigrations";
import {
  ensureLocalSchemaMigrated,
  isLocalSchemaMigrationLockTimeoutError,
  LOCAL_SCHEMA_MIGRATIONS_TABLE,
  LocalSchemaMigrationLockTimeoutError,
  withLocalSchemaMigrationLock,
} from "./migrateLocalSchema";

const CURRENT_LEDGER = localSchemaSteps(localSchemaMigrations).map(
  ({ name, version }) => `${version}:${name}`,
);

function installAbortableWebLocks(): () => void {
  const previous = Object.getOwnPropertyDescriptor(navigator, "locks");
  const queues = new Map<
    string,
    Array<{
      readonly callback: () => Promise<unknown>;
      readonly reject: (reason?: unknown) => void;
      readonly resolve: (value: unknown) => void;
      readonly signal?: AbortSignal | undefined;
    }>
  >();
  const held = new Set<string>();
  const pump = (name: string) => {
    if (held.has(name)) return;
    const queue = queues.get(name);
    while (queue && queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      if (next.signal?.aborted) {
        next.reject(
          next.signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
        continue;
      }
      held.add(name);
      void Promise.resolve()
        .then(next.callback)
        .then(next.resolve, next.reject)
        .finally(() => {
          held.delete(name);
          pump(name);
        });
      return;
    }
  };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (
        name: string,
        optionsOrCallback:
          | (() => Promise<unknown>)
          | { readonly signal?: AbortSignal },
        maybeCallback?: () => Promise<unknown>,
      ) => {
        const callback =
          typeof optionsOrCallback === "function"
            ? optionsOrCallback
            : maybeCallback;
        const signal =
          typeof optionsOrCallback === "function"
            ? undefined
            : optionsOrCallback.signal;
        if (!callback) throw new Error("Missing Web Lock callback");
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason ?? new DOMException("Aborted", "AbortError"),
          );
        }
        return new Promise((resolve, reject) => {
          const entry = { callback, reject, resolve, signal };
          const queue = queues.get(name) ?? [];
          queue.push(entry);
          queues.set(name, queue);
          signal?.addEventListener(
            "abort",
            () => {
              const index = queue.indexOf(entry);
              if (index !== -1) {
                queue.splice(index, 1);
                reject(
                  signal.reason ?? new DOMException("Aborted", "AbortError"),
                );
              }
            },
            { once: true },
          );
          pump(name);
        });
      },
    },
  });
  return () => {
    if (previous) {
      Object.defineProperty(navigator, "locks", previous);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
  };
}

test("a migration check stops waiting past its Web Lock bound when another tab holds the lock", async () => {
  const uninstall = installAbortableWebLocks();
  let releaseHolder = () => {};
  const holderReleased = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });
  let signalHolderAcquired = () => {};
  const holderAcquired = new Promise<void>((resolve) => {
    signalHolderAcquired = resolve;
  });
  let holder: Promise<void> = Promise.resolve();
  const { close, execSql } = await createTestExecSql(
    "local-schema-lock-timeout",
  );
  try {
    holder = withLocalSchemaMigrationLock(async () => {
      signalHolderAcquired();
      await holderReleased;
    });
    await holderAcquired;

    const startedAt = Date.now();
    const failure = await ensureLocalSchemaMigrated(execSql, async () => {}, {
      lockWaitTimeoutMs: 50,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(failure).toBeInstanceOf(LocalSchemaMigrationLockTimeoutError);
    expect(isLocalSchemaMigrationLockTimeoutError(failure)).toBe(true);
    expect(
      isLocalSchemaMigrationLockTimeoutError(
        new Error("wrapped", { cause: failure }),
      ),
    ).toBe(true);

    releaseHolder();
    await holder;

    await ensureLocalSchemaMigrated(execSql, async () => {}, {
      lockWaitTimeoutMs: 50,
    });
    const rows = await execSql(
      `SELECT version, name FROM "${LOCAL_SCHEMA_MIGRATIONS_TABLE}" ORDER BY version`,
    );
    expect(rows.map(({ name, version }) => `${version}:${name}`)).toEqual(
      CURRENT_LEDGER,
    );
  } finally {
    releaseHolder();
    await holder.catch(() => undefined);
    close();
    uninstall();
  }
});

test("a real callback failure is not misclassified as a lock timeout if the timer raced grant", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: { readonly signal?: AbortSignal },
        callback: () => Promise<unknown>,
      ) => {
        // Grant the lock after the wait timeout already fired.
        await Bun.sleep(40);
        return callback();
      },
    },
  });
  try {
    const failure = await withLocalSchemaMigrationLock(
      async () => {
        throw new Error("real migration failure");
      },
      { waitTimeoutMs: 10 },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isLocalSchemaMigrationLockTimeoutError(failure)).toBe(false);
    expect(failure).toEqual(new Error("real migration failure"));
  } finally {
    if (previous) {
      Object.defineProperty(navigator, "locks", previous);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
  }
});

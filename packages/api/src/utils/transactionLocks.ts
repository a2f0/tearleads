import {
  type DatabaseSession,
  isDatabaseTransaction,
} from "@tearleads/api-shared/postgres";

/** `exclusive` covers both modes; `shared` covers only another shared request. */
export type HeldLockMode = "exclusive" | "shared";

const heldLocksByTransaction = new WeakMap<
  DatabaseSession,
  Map<string, HeldLockMode>
>();

/**
 * Whether this transaction already holds `key` in a mode at least as strong as
 * `mode`. Transaction-scoped locks are held until commit or rollback, and the
 * API opens no savepoints, so a lock this transaction acquired stays held for
 * the rest of it. The memo is keyed by the transaction object and dies with
 * it; the root executor never records anything.
 */
export function transactionHoldsLock(
  executor: DatabaseSession,
  key: string,
  mode: HeldLockMode,
): boolean {
  const held = heldLocksByTransaction.get(executor)?.get(key);
  return held === "exclusive" || held === mode;
}

/** Record a lock the transaction now holds; call only after it was granted. */
export function recordTransactionLock(
  executor: DatabaseSession,
  key: string,
  mode: HeldLockMode,
): void {
  if (!isDatabaseTransaction(executor)) return;
  let held = heldLocksByTransaction.get(executor);
  if (!held) {
    held = new Map();
    heldLocksByTransaction.set(executor, held);
  }
  if (held.get(key) !== "exclusive") held.set(key, mode);
}

/**
 * Acquire a transaction-scoped lock unless this transaction already holds it
 * in a covering mode. Re-requesting a held lock never waits, so skipping it
 * changes no lock order.
 */
export async function acquireTransactionLock(
  executor: DatabaseSession,
  key: string,
  mode: HeldLockMode,
  acquire: () => Promise<unknown>,
): Promise<void> {
  if (transactionHoldsLock(executor, key, mode)) return;
  await acquire();
  recordTransactionLock(executor, key, mode);
}

export function advisoryLockKey(keys: readonly [number, number]): string {
  return `advisory:${keys[0]}:${keys[1]}`;
}

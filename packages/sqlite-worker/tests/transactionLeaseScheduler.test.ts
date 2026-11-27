import { expect, test } from "bun:test";
import {
  TransactionLease,
  type TransactionLeaseHost,
  type TransactionLeaseRevocation,
} from "../src/transactionLease";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "../src/types";

// The scheduler on a fake handle and clock, with the database queue drained
// by hand, so a test can hold the lease's timer tick in the queue ahead of a
// statement that arrives after it fired.
function fakeHost(overrides: Partial<TransactionLeaseHost<string>> = {}) {
  const queue: Array<() => void> = [];
  const revocations: Array<[string, TransactionLeaseRevocation]> = [];
  const clock = { now: 0 };
  const handle = { autocommit: true, failed: 0, rollbacks: 0 };
  const host: TransactionLeaseHost<string> = {
    bounds: { idleMs: 100, waitMs: 1_000 },
    enqueue: (operation) => queue.push(operation),
    fail: () => {
      handle.failed += 1;
    },
    isAutocommit: () => handle.autocommit,
    now: () => clock.now,
    revoke: (holder, revocation) => revocations.push([holder, revocation]),
    rollback: () => {
      handle.rollbacks += 1;
      handle.autocommit = true;
    },
    ...overrides,
  };
  const drain = () => {
    while (queue.length > 0) {
      queue.shift()?.();
    }
  };
  // The lease's timer runs on real time and enqueues its tick.
  const timerFired = async () => {
    const queued = queue.length;
    for (let waited = 0; queue.length === queued; waited += 5) {
      if (waited > 1_000) {
        throw new Error("The lease armed no timer.");
      }
      await Bun.sleep(5);
    }
  };
  return { clock, drain, handle, host, queue, revocations, timerFired };
}

// A statement that leaves the fake handle in or out of a transaction.
function statement(
  handle: { autocommit: boolean },
  autocommit: boolean,
  log: string[],
  name: string,
) {
  return () => {
    log.push(name);
    handle.autocommit = autocommit;
    return [];
  };
}

test("a holder whose statement arrived before the idle check ran is not revoked", async () => {
  const { clock, drain, handle, host, queue, revocations, timerFired } =
    fakeHost();
  const lease = new TransactionLease(host);
  const ran: string[] = [];

  const begin = lease.submit("a", statement(handle, false, ran, "a:begin"));
  drain();
  await begin;
  const waiter = lease.submit("b", statement(handle, true, ran, "b:write"));
  drain();

  // The idle check fires, and before it runs the holder's next statement
  // arrives after a long silence; it is pending when the check runs.
  await timerFired();
  clock.now = 500;
  const holderNext = lease.submit(
    "a",
    statement(handle, true, ran, "a:commit"),
  );
  expect(queue).toHaveLength(2);
  drain();

  await Promise.all([holderNext, waiter]);
  expect(revocations).toEqual([]);
  expect(handle.rollbacks).toBe(0);
  expect(ran).toEqual(["a:begin", "a:commit", "b:write"]);
});

test("a stalled holder is rolled back and reported with how long it idled and who waited", async () => {
  const { clock, drain, handle, host, revocations, timerFired } = fakeHost();
  const lease = new TransactionLease(host);
  const ran: string[] = [];

  const begin = lease.submit("a", statement(handle, false, ran, "a:begin"));
  drain();
  await begin;
  const waiters = [
    lease.submit("b", statement(handle, true, ran, "b:write")),
    lease.submit("c", statement(handle, true, ran, "c:write")),
  ];
  drain();

  await timerFired();
  clock.now = 150;
  drain();

  await Promise.all(waiters);
  expect(revocations).toEqual([["a", { idleMs: 150, waiting: 2 }]]);
  expect(ran).toEqual(["a:begin", "b:write", "c:write"]);
});

test("a waiter past the wait bound is refused and never runs", async () => {
  const { clock, drain, handle, host, timerFired } = fakeHost({
    bounds: { idleMs: 10_000, waitMs: 100 },
  });
  const lease = new TransactionLease(host);
  const ran: string[] = [];

  const begin = lease.submit("a", statement(handle, false, ran, "a:begin"));
  drain();
  await begin;
  const waiter = lease.submit("b", statement(handle, true, ran, "b:write"));
  drain();

  await timerFired();
  clock.now = 100;
  drain();
  await expect(waiter).rejects.toThrow(DATABASE_TRANSACTION_BUSY_MESSAGE);

  const commit = lease.submit("a", statement(handle, true, ran, "a:commit"));
  drain();
  await commit;
  expect(ran).toEqual(["a:begin", "a:commit"]);
});

test("a rollback that cannot end the transaction fails the database", async () => {
  const { drain, handle, host } = fakeHost({
    rollback: () => {
      throw new Error("cannot rollback - SQL statements in progress");
    },
  });
  const lease = new TransactionLease(host);

  const begin = lease.submit("a", statement(handle, false, [], "a:begin"));
  drain();
  await begin;
  lease.close("a", "closed");
  drain();

  expect(handle.failed).toBe(1);
  expect(handle.autocommit).toBe(false);
});

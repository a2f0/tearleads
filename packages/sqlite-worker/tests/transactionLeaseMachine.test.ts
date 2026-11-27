import { expect, test } from "bun:test";
import {
  FREE_TRANSACTION_LEASE,
  mayRunUnderTransactionLease,
  TRANSACTION_LEASE_IDLE_MS,
  TRANSACTION_LEASE_WAIT_MS,
  type TransactionLeaseEvent,
  type TransactionLeaseState,
  transitionTransactionLease,
} from "../src/transactionLeaseMachine";

type Lease = TransactionLeaseState<string>;
type LeaseEvent = TransactionLeaseEvent<string>;

const held = (activeAt: number): Lease => ({
  activeAt,
  holder: "a",
  status: "held",
});

const idleCheck = (
  at: number,
  overrides: Partial<Extract<LeaseEvent, { type: "idleCheck" }>> = {},
): LeaseEvent => ({
  at,
  holderPending: false,
  idleLimitMs: 100,
  othersWaiting: true,
  type: "idleCheck",
  ...overrides,
});

test("the idle bound is below the wait bound, so a stalled holder is revoked before a waiter is refused", () => {
  expect(TRANSACTION_LEASE_IDLE_MS).toBeLessThan(TRANSACTION_LEASE_WAIT_MS);
});

test.each<[string, Lease, LeaseEvent, Lease]>([
  [
    "a statement that leaves a transaction open takes the free lease",
    FREE_TRANSACTION_LEASE,
    { at: 5, autocommit: false, connection: "a", type: "statementSettled" },
    held(5),
  ],
  [
    "a statement in autocommit mode leaves the lease free",
    FREE_TRANSACTION_LEASE,
    { at: 5, autocommit: true, connection: "a", type: "statementSettled" },
    FREE_TRANSACTION_LEASE,
  ],
  [
    "the holder's statement that ends its transaction frees the lease",
    held(5),
    { at: 9, autocommit: true, connection: "a", type: "statementSettled" },
    FREE_TRANSACTION_LEASE,
  ],
  [
    "the holder's statement inside its transaction moves its clock",
    held(5),
    { at: 9, autocommit: false, connection: "a", type: "statementSettled" },
    held(9),
  ],
  [
    "a statement arriving from the holder moves its clock",
    held(5),
    { at: 7, connection: "a", type: "statementArrived" },
    held(7),
  ],
  [
    "a statement settling before a later arrival keeps the later clock",
    held(9),
    { at: 7, autocommit: false, connection: "a", type: "statementSettled" },
    held(9),
  ],
  [
    "another connection's arrival leaves the holder's clock alone",
    held(5),
    { at: 7, connection: "b", type: "statementArrived" },
    held(5),
  ],
  [
    "the holder closing starts the rollback",
    held(5),
    { connection: "a", type: "holderClosed" },
    { cause: "holderClosed", holder: "a", idleMs: 0, status: "releasing" },
  ],
  [
    "another connection closing leaves the lease held",
    held(5),
    { connection: "b", type: "holderClosed" },
    held(5),
  ],
  [
    "a holder idle past the bound while another waits is revoked",
    held(5),
    idleCheck(105),
    { cause: "holderStalled", holder: "a", idleMs: 100, status: "releasing" },
  ],
  [
    "a holder inside the bound is not revoked",
    held(5),
    idleCheck(104),
    held(5),
  ],
  [
    "a holder nobody waits for is not revoked",
    held(5),
    idleCheck(500, { othersWaiting: false }),
    held(5),
  ],
  [
    "a holder with a statement already pending is never revoked",
    held(5),
    idleCheck(5_000, { holderPending: true }),
    held(5),
  ],
  [
    "a rollback that ends the transaction frees the lease",
    { cause: "holderStalled", holder: "a", idleMs: 100, status: "releasing" },
    { autocommit: true, type: "rolledBack" },
    FREE_TRANSACTION_LEASE,
  ],
  [
    "a rollback that leaves the transaction open fails the lease",
    { cause: "holderClosed", holder: "a", idleMs: 0, status: "releasing" },
    { autocommit: false, type: "rolledBack" },
    { status: "failed" },
  ],
  [
    "a statement settling while the rollback runs changes nothing",
    { cause: "holderClosed", holder: "a", idleMs: 0, status: "releasing" },
    { at: 9, autocommit: false, connection: "b", type: "statementSettled" },
    { cause: "holderClosed", holder: "a", idleMs: 0, status: "releasing" },
  ],
  [
    "a failed lease absorbs every event",
    { status: "failed" },
    { at: 9, autocommit: false, connection: "b", type: "statementSettled" },
    { status: "failed" },
  ],
])("%s", (_name, state, event, expected) => {
  expect(transitionTransactionLease(state, event)).toEqual(expected);
});

test("only the holder runs while the lease is held, and nobody while it is released", () => {
  expect(mayRunUnderTransactionLease(FREE_TRANSACTION_LEASE, "b")).toBe(true);
  expect(mayRunUnderTransactionLease(held(5), "a")).toBe(true);
  expect(mayRunUnderTransactionLease(held(5), "b")).toBe(false);
  for (const state of [
    {
      cause: "holderClosed",
      holder: "a",
      idleMs: 0,
      status: "releasing",
    } as const,
    { status: "failed" } as const,
  ]) {
    expect(mayRunUnderTransactionLease<string>(state, "a")).toBe(false);
    expect(mayRunUnderTransactionLease<string>(state, "b")).toBe(false);
  }
});

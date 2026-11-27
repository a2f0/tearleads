import { expect, test } from "bun:test";
import {
  type CrossTabConnectionEvent,
  type CrossTabConnectionState,
  connectionEventForRequest,
  connectionEventForResponse,
  isOpenCrossTabConnection,
  transitionCrossTabConnection,
} from "../src/crossTabConnectionMachine";
import {
  DATABASE_DELETED_MESSAGE,
  DATABASE_NOT_INITIALIZED_MESSAGE,
  DATABASE_TRANSACTION_BUSY_MESSAGE,
  DATABASE_TRANSACTION_REVOKED_MESSAGE,
  WORKER_DATABASE_DELETED_MESSAGE_TYPE,
} from "../src/types";

const unbound: CrossTabConnectionState = { status: "unbound" };
const bound: CrossTabConnectionState = { status: "bound" };
const closing: CrossTabConnectionState = { status: "closing" };
const lost: CrossTabConnectionState = { reason: "ownerGone", status: "lost" };
const revokedDetail = `${DATABASE_TRANSACTION_REVOKED_MESSAGE} (database a.db, idle 3000 ms, 1 statement(s) waiting)`;
const revoked: CrossTabConnectionState = {
  detail: revokedDetail,
  reason: "transactionRevoked",
  status: "lost",
};

const opened: CrossTabConnectionEvent = { type: "opened" };
const closeRequested: CrossTabConnectionEvent = { type: "closeRequested" };
const databaseMissing: CrossTabConnectionEvent = { type: "databaseMissing" };
const databaseDeleted: CrossTabConnectionEvent = { type: "databaseDeleted" };
const ownerGone: CrossTabConnectionEvent = { type: "ownerGone" };
const transactionRevoked: CrossTabConnectionEvent = {
  detail: revokedDetail,
  type: "transactionRevoked",
};

test.each([
  [unbound, opened, bound],
  [unbound, closeRequested, closing],
  [unbound, databaseMissing, unbound],
  [unbound, databaseDeleted, unbound],
  [unbound, ownerGone, unbound],
  [unbound, transactionRevoked, unbound],
  [bound, opened, bound],
  [bound, closeRequested, closing],
  [bound, databaseMissing, lost],
  [bound, databaseDeleted, unbound],
  [bound, ownerGone, lost],
  [bound, transactionRevoked, revoked],
  [closing, opened, closing],
  [closing, closeRequested, closing],
  [closing, databaseMissing, closing],
  [closing, databaseDeleted, closing],
  [closing, ownerGone, lost],
  [closing, transactionRevoked, closing],
  [lost, opened, lost],
  [lost, closeRequested, lost],
  [lost, databaseMissing, lost],
  [lost, databaseDeleted, lost],
  [lost, ownerGone, lost],
  [lost, transactionRevoked, lost],
  [revoked, ownerGone, revoked],
] as const)("%o on %o becomes %o", (state, event, next) => {
  expect(transitionCrossTabConnection(state, event)).toEqual(next);
});

test("only an unbound or bound client still needs an owner", () => {
  expect(isOpenCrossTabConnection(unbound)).toBe(true);
  expect(isOpenCrossTabConnection(bound)).toBe(true);
  expect(isOpenCrossTabConnection(closing)).toBe(false);
  expect(isOpenCrossTabConnection(lost)).toBe(false);
  expect(isOpenCrossTabConnection(revoked)).toBe(false);
});

test("a close or delete request starts the teardown", () => {
  expect(connectionEventForRequest("close")).toEqual(closeRequested);
  expect(connectionEventForRequest("delete")).toEqual(closeRequested);
  expect(connectionEventForRequest("prepareDelete")).toBeNull();
  expect(connectionEventForRequest("exec")).toBeNull();
  expect(connectionEventForRequest(null)).toBeNull();
});

function failure(message: string) {
  return { id: 1, result: { ok: false, message } };
}

test("only a successful init opens the database", () => {
  const success = { id: 1, result: { ok: true } };
  expect(connectionEventForResponse("init", success)).toEqual(opened);
  for (const method of ["close", "delete", "exec", "ping", null]) {
    expect(connectionEventForResponse(method, success)).toBeNull();
  }
});

test("a worker's answer tells a missing database from a deleted one", () => {
  expect(
    connectionEventForResponse(
      "exec",
      failure(DATABASE_NOT_INITIALIZED_MESSAGE),
    ),
  ).toEqual(databaseMissing);
  // A deliberate delete elsewhere is not a loss to recover from, whether the
  // worker announces it or answers a later statement with it.
  expect(
    connectionEventForResponse("exec", failure(DATABASE_DELETED_MESSAGE)),
  ).toEqual(databaseDeleted);
  expect(
    connectionEventForResponse(null, {
      type: WORKER_DATABASE_DELETED_MESSAGE_TYPE,
    }),
  ).toEqual(databaseDeleted);
  expect(
    connectionEventForResponse("exec", failure("no such table: t")),
  ).toBeNull();
  // A revoked transaction retires the client; a busy refusal is an ordinary
  // failed statement the caller may retry.
  expect(connectionEventForResponse("exec", failure(revokedDetail))).toEqual(
    transactionRevoked,
  );
  expect(
    connectionEventForResponse(
      "exec",
      failure(DATABASE_TRANSACTION_BUSY_MESSAGE),
    ),
  ).toBeNull();
  expect(
    connectionEventForResponse(
      "init",
      failure("Timed out waiting for the database owner tab."),
    ),
  ).toBeNull();
  expect(
    connectionEventForResponse("exec", {
      type: "tearleads:sqlite-port-disconnected",
    }),
  ).toBeNull();
});

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
} from "../src/types";

const unbound: CrossTabConnectionState = { status: "unbound" };
const bound: CrossTabConnectionState = { status: "bound" };
const closing: CrossTabConnectionState = { status: "closing" };
const lost: CrossTabConnectionState = { status: "lost" };

const opened: CrossTabConnectionEvent = { type: "opened" };
const closeRequested: CrossTabConnectionEvent = { type: "closeRequested" };
const databaseMissing: CrossTabConnectionEvent = { type: "databaseMissing" };
const databaseDeleted: CrossTabConnectionEvent = { type: "databaseDeleted" };
const ownerGone: CrossTabConnectionEvent = { type: "ownerGone" };

test.each([
  [unbound, opened, bound],
  [unbound, closeRequested, closing],
  [unbound, databaseMissing, unbound],
  [unbound, databaseDeleted, unbound],
  [unbound, ownerGone, unbound],
  [bound, opened, bound],
  [bound, closeRequested, closing],
  [bound, databaseMissing, lost],
  [bound, databaseDeleted, unbound],
  [bound, ownerGone, lost],
  [closing, opened, closing],
  [closing, closeRequested, closing],
  [closing, databaseMissing, closing],
  [closing, databaseDeleted, closing],
  [closing, ownerGone, lost],
  [lost, opened, lost],
  [lost, closeRequested, lost],
  [lost, databaseMissing, lost],
  [lost, databaseDeleted, lost],
  [lost, ownerGone, lost],
] as const)("%o on %o becomes %o", (state, event, next) => {
  expect(transitionCrossTabConnection(state, event)).toEqual(next);
});

test("only an unbound or bound client still needs an owner", () => {
  expect(isOpenCrossTabConnection(unbound)).toBe(true);
  expect(isOpenCrossTabConnection(bound)).toBe(true);
  expect(isOpenCrossTabConnection(closing)).toBe(false);
  expect(isOpenCrossTabConnection(lost)).toBe(false);
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
  // A deliberate delete elsewhere is not a loss to recover from.
  expect(
    connectionEventForResponse("exec", failure(DATABASE_DELETED_MESSAGE)),
  ).toEqual(databaseDeleted);
  expect(
    connectionEventForResponse("exec", failure("no such table: t")),
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

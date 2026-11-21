import { expect, test } from "bun:test";
import {
  type CrossTabConnectionEvent,
  type CrossTabConnectionState,
  connectionEventForResponse,
  transitionCrossTabConnection,
} from "../src/crossTabConnectionMachine";
import { DATABASE_NOT_INITIALIZED_MESSAGE } from "../src/types";

const unbound: CrossTabConnectionState = { status: "unbound" };
const bound: CrossTabConnectionState = { status: "bound" };
const lost: CrossTabConnectionState = { status: "lost" };

const opened: CrossTabConnectionEvent = { type: "opened" };
const closed: CrossTabConnectionEvent = { type: "closed" };
const databaseMissing: CrossTabConnectionEvent = { type: "databaseMissing" };
const ownerGone: CrossTabConnectionEvent = { type: "ownerGone" };

test.each([
  [unbound, opened, bound],
  [unbound, closed, unbound],
  [unbound, databaseMissing, unbound],
  [unbound, ownerGone, unbound],
  [bound, opened, bound],
  [bound, closed, unbound],
  [bound, databaseMissing, lost],
  [bound, ownerGone, lost],
  [lost, opened, lost],
  [lost, closed, lost],
  [lost, databaseMissing, lost],
  [lost, ownerGone, lost],
] as const)("%o on %o becomes %o", (state, event, next) => {
  expect(transitionCrossTabConnection(state, event)).toEqual(next);
});

function failure(message: string) {
  return { id: 1, result: { ok: false, message } };
}

test("a successful init opens and a successful teardown closes", () => {
  const success = { id: 1, result: { ok: true } };
  for (const [method, event] of [
    ["init", opened],
    ["close", closed],
    ["delete", closed],
    ["exec", null],
    ["ping", null],
    [null, null],
  ] as const) {
    expect(
      connectionEventForResponse({ closing: false, method, response: success }),
    ).toEqual(event);
  }
});

test("only a missing database outside teardown reports the database missing", () => {
  expect(
    connectionEventForResponse({
      closing: false,
      method: "exec",
      response: failure(DATABASE_NOT_INITIALIZED_MESSAGE),
    }),
  ).toEqual(databaseMissing);
  expect(
    connectionEventForResponse({
      closing: true,
      method: "exec",
      response: failure(DATABASE_NOT_INITIALIZED_MESSAGE),
    }),
  ).toBeNull();
  expect(
    connectionEventForResponse({
      closing: false,
      method: "exec",
      response: failure("no such table: t"),
    }),
  ).toBeNull();
  expect(
    connectionEventForResponse({
      closing: false,
      method: "init",
      response: failure("Timed out waiting for the database owner tab."),
    }),
  ).toBeNull();
  expect(
    connectionEventForResponse({
      closing: false,
      method: "exec",
      response: { type: "tearleads:sqlite-port-disconnected" },
    }),
  ).toBeNull();
});

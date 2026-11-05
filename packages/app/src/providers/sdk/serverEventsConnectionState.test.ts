import { describe, expect, test } from "bun:test";
import {
  connectionSocket,
  SERVER_EVENTS_IDLE,
  type ServerEventsConnectionEvent,
  type ServerEventsConnectionState,
  transitionServerEventsConnection,
} from "./serverEventsConnectionState";

const SOCKET_ONE = new EventTarget() as unknown as WebSocket;
const SOCKET_TWO = new EventTarget() as unknown as WebSocket;

type State = ServerEventsConnectionState;
type Event = ServerEventsConnectionEvent;

const idle: State = SERVER_EVENTS_IDLE;
const requesting1: State = { attempt: 1, status: "requesting-ticket" };
const requesting2: State = { attempt: 2, status: "requesting-ticket" };
const opening1: State = { attempt: 1, socket: SOCKET_ONE, status: "opening" };
const open1: State = {
  attempt: 1,
  openedAtMs: 5,
  socket: SOCKET_ONE,
  status: "open",
};
const backoff1: State = { attempt: 1, status: "backoff" };
const stopped: State = { status: "stopped" };

function run(state: State, events: ReadonlyArray<Event>): State {
  return events.reduce(transitionServerEventsConnection, state);
}

describe("server events connection transitions", () => {
  test.each<[string, State, Event, State]>([
    ["idle + start", idle, { type: "start" }, requesting1],
    [
      "requesting + attempt-failed",
      requesting1,
      { attempt: 1, type: "attempt-failed" },
      backoff1,
    ],
    [
      "requesting + socket-bound",
      requesting1,
      { attempt: 1, socket: SOCKET_ONE, type: "socket-bound" },
      opening1,
    ],
    [
      "opening + socket-opened",
      opening1,
      { atMs: 5, attempt: 1, type: "socket-opened" },
      open1,
    ],
    [
      "opening + socket-closed",
      opening1,
      { attempt: 1, type: "socket-closed" },
      backoff1,
    ],
    [
      "open + socket-closed",
      open1,
      { attempt: 1, type: "socket-closed" },
      backoff1,
    ],
    ["backoff + retry", backoff1, { attempt: 1, type: "retry" }, requesting2],
    ["idle + stop", idle, { type: "stop" }, stopped],
    ["requesting + stop", requesting1, { type: "stop" }, stopped],
    ["open + stop", open1, { type: "stop" }, stopped],
    ["backoff + stop", backoff1, { type: "stop" }, stopped],
  ])("%s", (_name, state, event, next) => {
    expect(transitionServerEventsConnection(state, event)).toEqual(next);
  });

  test.each<[string, State, Event]>([
    ["requesting + start", requesting1, { type: "start" }],
    ["open + start", open1, { type: "start" }],
    ["backoff + start", backoff1, { type: "start" }],
    ["stopped + start", stopped, { type: "start" }],
    ["stopped + stop", stopped, { type: "stop" }],
    ["stopped + retry", stopped, { attempt: 1, type: "retry" }],
    [
      "stopped + socket-bound",
      stopped,
      { attempt: 1, socket: SOCKET_ONE, type: "socket-bound" },
    ],
    [
      "requesting 2 + attempt-failed 1",
      requesting2,
      { attempt: 1, type: "attempt-failed" },
    ],
    [
      "requesting 2 + socket-bound 1",
      requesting2,
      { attempt: 1, socket: SOCKET_ONE, type: "socket-bound" },
    ],
    [
      "opening + socket-bound",
      opening1,
      { attempt: 1, socket: SOCKET_TWO, type: "socket-bound" },
    ],
    [
      "open + socket-opened",
      open1,
      { atMs: 9, attempt: 1, type: "socket-opened" },
    ],
    [
      "backoff + socket-closed",
      backoff1,
      { attempt: 1, type: "socket-closed" },
    ],
    [
      "backoff + retry for another attempt",
      backoff1,
      { attempt: 2, type: "retry" },
    ],
    ["requesting + retry", requesting1, { attempt: 1, type: "retry" }],
    ["idle + socket-closed", idle, { attempt: 1, type: "socket-closed" }],
  ])("%s is ignored (same reference)", (_name, state, event) => {
    expect(transitionServerEventsConnection(state, event)).toBe(state);
  });

  test("a stale attempt cannot advance a newer one", () => {
    // start(1) -> reset (attempt 1 fails) -> start(2) -> 1 succeeds late.
    const state = run(idle, [
      { type: "start" },
      { attempt: 1, type: "attempt-failed" },
      { attempt: 1, type: "retry" },
      { attempt: 1, socket: SOCKET_ONE, type: "socket-bound" },
      { atMs: 1, attempt: 1, type: "socket-opened" },
      { attempt: 1, type: "socket-closed" },
    ]);
    expect(state).toEqual(requesting2);
  });

  test("a replacement attempt binds its own socket", () => {
    const state = run(requesting2, [
      { attempt: 2, socket: SOCKET_TWO, type: "socket-bound" },
      { atMs: 3, attempt: 2, type: "socket-opened" },
    ]);
    expect(state).toEqual({
      attempt: 2,
      openedAtMs: 3,
      socket: SOCKET_TWO,
      status: "open",
    });
    expect(connectionSocket(state)).toBe(SOCKET_TWO);
  });

  test("only opening and open states own a socket", () => {
    expect(connectionSocket(opening1)).toBe(SOCKET_ONE);
    for (const state of [idle, requesting1, backoff1, stopped]) {
      expect(connectionSocket(state)).toBeNull();
    }
  });
});

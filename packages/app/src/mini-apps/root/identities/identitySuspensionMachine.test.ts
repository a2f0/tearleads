import { expect, test } from "bun:test";
import {
  IDLE_SUSPENSION,
  type IdentitySuspensionEvent,
  type IdentitySuspensionState,
  transitionIdentitySuspension,
} from "./identitySuspensionMachine";

const A = Symbol("a");
const B = Symbol("b");
const idle = (error: string | null = null): IdentitySuspensionState => ({
  error,
  status: "idle",
});
const confirming = (error: string | null = null): IdentitySuspensionState => ({
  error,
  status: "confirming",
});
const lifting: IdentitySuspensionState = {
  change: "lift",
  request: A,
  status: "running",
};
const suspending: IdentitySuspensionState = {
  change: "suspend",
  request: A,
  status: "running",
};

const ASK: IdentitySuspensionEvent = { type: "ask-to-suspend" };
const CANCEL: IdentitySuspensionEvent = { type: "cancel" };
const startLift = (request = A): IdentitySuspensionEvent => ({
  change: "lift",
  request,
  type: "start",
});
const startSuspend = (request = A): IdentitySuspensionEvent => ({
  change: "suspend",
  request,
  type: "start",
});
const settle = (
  request: symbol,
  error: string | null = null,
): IdentitySuspensionEvent => ({ error, request, type: "settle" });

test.each<
  [
    string,
    IdentitySuspensionState,
    IdentitySuspensionEvent,
    IdentitySuspensionState,
  ]
>([
  // Legal moves.
  ["asking keeps the last failure", idle("denied"), ASK, confirming("denied")],
  [
    "cancelling keeps the last failure",
    confirming("denied"),
    CANCEL,
    idle("denied"),
  ],
  ["a lift starts from rest", idle("denied"), startLift(), lifting],
  [
    "a suspension starts from its confirmation, clearing the last failure",
    confirming("denied"),
    startSuspend(),
    suspending,
  ],
  ["a change that succeeds clears to rest", lifting, settle(A), idle()],
  [
    "a change that fails shows why",
    suspending,
    settle(A, "denied"),
    idle("denied"),
  ],
  // Ignored events.
  [
    "a suspension never starts without its confirmation",
    idle(),
    startSuspend(),
    idle(),
  ],
  [
    "a lift does not start from a confirmation",
    confirming(),
    startLift(),
    confirming(),
  ],
  [
    "asking again while confirming changes nothing",
    confirming(),
    ASK,
    confirming(),
  ],
  ["nothing asks while a change runs", lifting, ASK, lifting],
  ["a running suspension cannot be cancelled", suspending, CANCEL, suspending],
  ["nothing starts while a change runs", lifting, startLift(B), lifting],
  ["cancel at rest changes nothing", idle("denied"), CANCEL, idle("denied")],
  ["a settle at rest changes nothing", idle(), settle(A, "late"), idle()],
  [
    "a settle while confirming changes nothing",
    confirming(),
    settle(A, "late"),
    confirming(),
  ],
  ["only the running request may settle", lifting, settle(B, "stale"), lifting],
])("%s", (_name, state, event, next) => {
  expect(transitionIdentitySuspension(state, event)).toEqual(next);
});

test("a second click before a render cannot start a second change", () => {
  const first = transitionIdentitySuspension(IDLE_SUSPENSION, startLift(A));
  const second = transitionIdentitySuspension(first, startLift(B));
  // The second caller sees its own request did not enter running.
  expect(second).toEqual(lifting);
  expect(second.status === "running" && second.request === B).toBe(false);
});

test("a stale settle cannot finish a newer change", () => {
  const events: IdentitySuspensionEvent[] = [
    startLift(A),
    settle(A, "denied"),
    ASK,
    startSuspend(B),
    settle(A, null),
  ];
  expect(events.reduce(transitionIdentitySuspension, IDLE_SUSPENSION)).toEqual({
    change: "suspend",
    request: B,
    status: "running",
  });
});

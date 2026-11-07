import { expect, test } from "bun:test";
import type { DirectCheckoutSession } from "@tearleads/client-sdk";
import {
  type DirectCheckoutEvent,
  type DirectCheckoutMachineState,
  IDLE_DIRECT_CHECKOUT,
  transitionDirectCheckout,
} from "./directCheckoutMachine";

const session: DirectCheckoutSession = {
  confirm: () => Promise.resolve({ kind: "succeeded" }),
  unmount: () => undefined,
};
const other: DirectCheckoutSession = { ...session };

const failedIdle: DirectCheckoutMachineState = { kind: "idle", error: "x" };
const starting: DirectCheckoutMachineState = {
  kind: "starting",
  attempt: 1,
  emailComplete: false,
};
const collecting: DirectCheckoutMachineState = {
  kind: "collecting",
  attempt: 1,
  emailComplete: true,
  session,
  error: null,
};
const confirming: DirectCheckoutMachineState = {
  kind: "confirming",
  attempt: 1,
  emailComplete: true,
  session,
};

const begin: DirectCheckoutEvent = { type: "begin", attempt: 2 };
const email = (attempt: number, complete = true): DirectCheckoutEvent => ({
  type: "email-changed",
  attempt,
  complete,
});
const mounted = (attempt: number): DirectCheckoutEvent => ({
  type: "mounted",
  attempt,
  session: other,
});
const startFailed = (attempt: number): DirectCheckoutEvent => ({
  type: "start-failed",
  attempt,
  error: "unavailable",
});
const confirm: DirectCheckoutEvent = { type: "confirm" };
const confirmFailed = (attempt: number): DirectCheckoutEvent => ({
  type: "confirm-failed",
  attempt,
  error: "declined",
});
const confirmed = (attempt: number): DirectCheckoutEvent => ({
  type: "confirmed",
  attempt,
});
const teardown: DirectCheckoutEvent = { type: "teardown" };

test.each<[string, DirectCheckoutMachineState, DirectCheckoutEvent, unknown]>([
  ["idle begins", failedIdle, begin, { ...starting, attempt: 2 }],
  ["teardown clears an idle error", failedIdle, teardown, IDLE_DIRECT_CHECKOUT],
  [
    "starting tracks email",
    starting,
    email(1),
    { ...starting, emailComplete: true },
  ],
  [
    "starting mounts",
    starting,
    mounted(1),
    { ...starting, kind: "collecting", session: other, error: null },
  ],
  [
    "starting fails",
    starting,
    startFailed(1),
    { kind: "idle", error: "unavailable" },
  ],
  ["starting tears down", starting, teardown, IDLE_DIRECT_CHECKOUT],
  [
    "collecting tracks email",
    collecting,
    email(1, false),
    { ...collecting, emailComplete: false },
  ],
  ["collecting confirms", collecting, confirm, confirming],
  ["collecting tears down", collecting, teardown, IDLE_DIRECT_CHECKOUT],
  [
    "confirming tracks email",
    confirming,
    email(1, false),
    { ...confirming, emailComplete: false },
  ],
  [
    "confirming fails back to collecting",
    confirming,
    confirmFailed(1),
    { ...collecting, error: "declined" },
  ],
  ["confirming finishes", confirming, confirmed(1), IDLE_DIRECT_CHECKOUT],
  ["confirming tears down", confirming, teardown, IDLE_DIRECT_CHECKOUT],
])("%s", (_name, state, event, next) => {
  expect(transitionDirectCheckout(state, event)).toEqual(next as never);
});

const ignored: [DirectCheckoutMachineState, DirectCheckoutEvent[]][] = [
  [
    IDLE_DIRECT_CHECKOUT,
    [
      email(1),
      mounted(1),
      startFailed(1),
      confirm,
      confirmFailed(1),
      confirmed(1),
      teardown,
    ],
  ],
  [
    starting,
    [
      begin,
      email(2),
      email(1, false),
      mounted(2),
      startFailed(2),
      confirm,
      confirmFailed(1),
      confirmed(1),
    ],
  ],
  [
    collecting,
    [
      begin,
      email(2),
      email(1),
      mounted(1),
      startFailed(1),
      confirmFailed(1),
      confirmed(1),
    ],
  ],
  [
    confirming,
    [
      begin,
      email(2),
      mounted(1),
      startFailed(1),
      confirm,
      confirmFailed(2),
      confirmed(2),
    ],
  ],
];

test.each(
  ignored.flatMap(([state, events]) =>
    events.map((event) => [state.kind, event.type, state, event] as const),
  ),
)("%s ignores %s", (_kind, _type, state, event) => {
  expect(transitionDirectCheckout(state, event)).toBe(state);
});

test("a superseded attempt cannot finish its replacement", () => {
  const events: DirectCheckoutEvent[] = [
    { type: "begin", attempt: 1 },
    mounted(1),
    confirm,
    teardown,
    begin,
    mounted(2),
    confirm,
    confirmFailed(1),
    confirmed(1),
  ];
  const state = events.reduce(transitionDirectCheckout, IDLE_DIRECT_CHECKOUT);
  expect(state).toMatchObject({ kind: "confirming", attempt: 2 });
});

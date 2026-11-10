import { expect, test } from "bun:test";
import type { DirectCheckoutSession } from "@tearleads/client-sdk";
import {
  type DirectCheckoutEvent,
  type DirectCheckoutMachineState,
  type DirectCheckoutPlan,
  IDLE_DIRECT_CHECKOUT,
  transitionDirectCheckout,
} from "./directCheckoutMachine";

const session: DirectCheckoutSession = {
  confirm: () => Promise.resolve({ kind: "succeeded" }),
  updatePrice: () => undefined,
  unmount: () => undefined,
};
const other: DirectCheckoutSession = { ...session };
const plan: DirectCheckoutPlan = {
  priceId: "price_solo",
  amount: 500,
  currency: "usd",
};
const team: DirectCheckoutPlan = {
  priceId: "price_team_5",
  amount: 1_000,
  currency: "usd",
};

const failedIdle: DirectCheckoutMachineState = { kind: "idle", error: "x" };
const starting: DirectCheckoutMachineState = {
  kind: "starting",
  attempt: 1,
  plan,
  emailComplete: false,
  formReady: false,
};
const collecting: DirectCheckoutMachineState = {
  kind: "collecting",
  attempt: 1,
  plan,
  emailComplete: true,
  formReady: true,
  session,
  error: null,
};
const loadingForm: DirectCheckoutMachineState = {
  ...collecting,
  emailComplete: false,
  formReady: false,
};
const confirming: DirectCheckoutMachineState = {
  kind: "confirming",
  attempt: 1,
  plan,
  emailComplete: true,
  session,
};
const openingStripe: DirectCheckoutMachineState = {
  kind: "opening-stripe",
  attempt: 1,
  plan,
  emailComplete: true,
  session,
};

const begin: DirectCheckoutEvent = { type: "begin", attempt: 2, plan };
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
const formReady = (attempt: number): DirectCheckoutEvent => ({
  type: "form-ready",
  attempt,
});
const loadFailed = (attempt: number): DirectCheckoutEvent => ({
  type: "load-failed",
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
const planChanged = (
  attempt: number,
  next: DirectCheckoutPlan,
): DirectCheckoutEvent => ({ type: "plan-changed", attempt, plan: next });
const planUnavailable = (attempt: number): DirectCheckoutEvent => ({
  type: "plan-unavailable",
  attempt,
  error: "plan unavailable",
});
const openStripe: DirectCheckoutEvent = { type: "open-stripe" };
const stripeOpened = (attempt: number): DirectCheckoutEvent => ({
  type: "stripe-opened",
  attempt,
});
const stripeRefused = (attempt: number): DirectCheckoutEvent => ({
  type: "stripe-refused",
  attempt,
  error: "refused",
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
    "starting records a form ready before the mount resolves",
    starting,
    formReady(1),
    { ...starting, formReady: true },
  ],
  [
    "a form ready before the mount stays ready once mounted",
    { ...starting, formReady: true },
    mounted(1),
    { ...loadingForm, formReady: true, session: other },
  ],
  [
    "starting load fails",
    starting,
    loadFailed(1),
    { kind: "idle", error: "unavailable" },
  ],
  [
    "a mounted form becomes ready",
    loadingForm,
    formReady(1),
    { ...loadingForm, formReady: true },
  ],
  [
    "a mounted form fails to load",
    loadingForm,
    loadFailed(1),
    { kind: "idle", error: "unavailable" },
  ],
  [
    "collecting tracks email",
    collecting,
    email(1, false),
    { ...collecting, emailComplete: false },
  ],
  ["collecting confirms", collecting, confirm, confirming],
  ["collecting tears down", collecting, teardown, IDLE_DIRECT_CHECKOUT],
  [
    "collecting switches to another plan and clears its error",
    { ...collecting, error: "declined" },
    planChanged(1, team),
    { ...collecting, plan: team },
  ],
  [
    "a form still loading can switch plans",
    loadingForm,
    planChanged(1, team),
    { ...loadingForm, plan: team },
  ],
  [
    "collecting closes a form whose plan is no longer offered",
    collecting,
    planUnavailable(1),
    { kind: "idle", error: "plan unavailable" },
  ],
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
  [
    "confirming closes a form whose plan is no longer offered",
    confirming,
    planUnavailable(1),
    { kind: "idle", error: "plan unavailable" },
  ],
  ["confirming tears down", confirming, teardown, IDLE_DIRECT_CHECKOUT],
  ["collecting opens Stripe's page", collecting, openStripe, openingStripe],
  [
    "opening Stripe's page tracks email",
    openingStripe,
    email(1, false),
    { ...openingStripe, emailComplete: false },
  ],
  [
    "Stripe's page took over, so the form closes",
    openingStripe,
    stripeOpened(1),
    IDLE_DIRECT_CHECKOUT,
  ],
  [
    "a refused Stripe page returns to the form with its error",
    openingStripe,
    stripeRefused(1),
    { ...collecting, error: "refused" },
  ],
  [
    "a plan no longer offered closes the form while Stripe's page opens",
    openingStripe,
    planUnavailable(1),
    { kind: "idle", error: "plan unavailable" },
  ],
  [
    "opening Stripe's page tears down",
    openingStripe,
    teardown,
    IDLE_DIRECT_CHECKOUT,
  ],
])("%s", (_name, state, event, next) => {
  expect(transitionDirectCheckout(state, event)).toEqual(next as never);
});

const ignored: [DirectCheckoutMachineState, DirectCheckoutEvent[]][] = [
  [
    IDLE_DIRECT_CHECKOUT,
    [
      email(1),
      formReady(1),
      loadFailed(1),
      mounted(1),
      startFailed(1),
      confirm,
      confirmFailed(1),
      planChanged(1, team),
      planUnavailable(1),
      confirmed(1),
      openStripe,
      stripeOpened(1),
      stripeRefused(1),
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
      formReady(2),
      loadFailed(2),
      startFailed(2),
      confirm,
      confirmFailed(1),
      planChanged(1, team),
      planUnavailable(1),
      confirmed(1),
      openStripe,
      stripeOpened(1),
    ],
  ],
  [
    collecting,
    [
      begin,
      email(2),
      email(1),
      formReady(1),
      formReady(2),
      loadFailed(2),
      mounted(1),
      startFailed(1),
      planChanged(1, plan),
      planChanged(2, team),
      confirmFailed(1),
      planUnavailable(2),
      confirmed(1),
      stripeOpened(1),
      stripeRefused(1),
    ],
  ],
  [loadingForm, [confirm, openStripe, formReady(2), loadFailed(2)]],
  [
    confirming,
    [
      begin,
      email(2),
      mounted(1),
      formReady(1),
      loadFailed(1),
      startFailed(1),
      planChanged(1, team),
      confirm,
      openStripe,
      confirmFailed(2),
      planUnavailable(2),
      confirmed(2),
      stripeOpened(1),
      stripeRefused(1),
    ],
  ],
  [
    openingStripe,
    [
      begin,
      email(2),
      mounted(1),
      formReady(1),
      loadFailed(1),
      planChanged(1, team),
      confirm,
      openStripe,
      confirmFailed(1),
      confirmed(1),
      planUnavailable(2),
      stripeOpened(2),
      stripeRefused(2),
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
    { type: "begin", attempt: 1, plan },
    mounted(1),
    formReady(1),
    confirm,
    teardown,
    begin,
    mounted(2),
    formReady(2),
    confirm,
    confirmFailed(1),
    confirmed(1),
  ];
  const state = events.reduce(transitionDirectCheckout, IDLE_DIRECT_CHECKOUT);
  expect(state).toMatchObject({ kind: "confirming", attempt: 2 });
});

import { expect, test } from "bun:test";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import {
  IDLE_STRIPE_PLAN_CHANGE,
  type StripePlanChangeEvent,
  type StripePlanChangeState,
  stripePlanDirection,
  transitionStripePlanChange,
} from "./stripePlanChangeMachine";

const TEAM: StripeSyncOptionResponse = {
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  priceId: "price_team_5",
  productName: "Team (up to 5)",
  seatLimit: 5,
  tierId: "team_5",
  unitAmount: 1_000,
};
const SOLO: StripeSyncOptionResponse = {
  ...TEAM,
  priceId: "price_sync",
  productName: "Solo",
  seatLimit: 1,
  tierId: "solo",
  unitAmount: 500,
};

const confirming: StripePlanChangeState = {
  kind: "confirming",
  direction: "upgrade",
  fromSeatCount: 1,
  option: TEAM,
};
const changing: StripePlanChangeState = { ...confirming, kind: "changing" };
const failedIdle: StripePlanChangeState = {
  kind: "idle",
  outcome: { kind: "failed", error: "declined" },
};

const choose = (option = TEAM): StripePlanChangeEvent => ({
  type: "choose",
  direction: option === TEAM ? "upgrade" : "downgrade",
  fromSeatCount: option === TEAM ? 1 : 5,
  option,
});
const changed: StripePlanChangeEvent = { type: "changed", change: "upgraded" };
const failed: StripePlanChangeEvent = { type: "failed", error: "declined" };

test.each<[string, StripePlanChangeState, StripePlanChangeEvent, unknown]>([
  [
    "idle asks to confirm a choice",
    IDLE_STRIPE_PLAN_CHANGE,
    choose(),
    confirming,
  ],
  [
    "a failure's notice gives way to a new choice",
    failedIdle,
    choose(),
    confirming,
  ],
  [
    "another choice replaces the one being confirmed",
    confirming,
    choose(SOLO),
    {
      kind: "confirming",
      direction: "downgrade",
      fromSeatCount: 5,
      option: SOLO,
    },
  ],
  [
    "dismissing returns to idle",
    confirming,
    { type: "dismiss" },
    IDLE_STRIPE_PLAN_CHANGE,
  ],
  ["confirming starts the change", confirming, { type: "confirm" }, changing],
  [
    "a change that took effect is reported",
    changing,
    changed,
    { kind: "idle", outcome: { kind: "changed", change: "upgraded" } },
  ],
  ["a refused change is reported", changing, failed, failedIdle],
])("%s", (_name, state, event, next) => {
  expect(transitionStripePlanChange(state, event)).toEqual(next as never);
});

test.each<[StripePlanChangeState, StripePlanChangeEvent[]]>([
  [
    IDLE_STRIPE_PLAN_CHANGE,
    [{ type: "dismiss" }, { type: "confirm" }, changed, failed],
  ],
  [confirming, [changed, failed]],
  // One change at a time: nothing interrupts a change being charged.
  [changing, [choose(SOLO), { type: "dismiss" }, { type: "confirm" }]],
])("%o ignores %o", (state, events) => {
  for (const event of events) {
    expect(transitionStripePlanChange(state, event)).toBe(state);
  }
});

test.each([
  [TEAM, 1, "upgrade"],
  [SOLO, 5, "downgrade"],
  [TEAM, 5, "keep"],
] as const)("%o at %i seats is a %s", (option, seatCount, direction) => {
  expect(stripePlanDirection(option, seatCount)).toBe(direction);
});

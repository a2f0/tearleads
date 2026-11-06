import { expect, test } from "bun:test";
import {
  initialOrgSubscriptionScan,
  type OrgSubscriptionScan,
  type OrgSubscriptionScanEvent,
  orgSubscriptionScanIsDecisive,
  transitionOrgSubscriptionScan,
} from "./orgSubscriptionScan";

const none: OrgSubscriptionScan = { status: "none", attemptUsed: false };
const noneUsed: OrgSubscriptionScan = { status: "none", attemptUsed: true };
const pending: OrgSubscriptionScan = {
  status: "pending",
  subscriptionId: "sub_pending",
  attemptUsed: false,
};
const pendingUsed: OrgSubscriptionScan = { ...pending, attemptUsed: true };
const live: OrgSubscriptionScan = {
  status: "live",
  subscriptionId: "sub_live_old",
};
const ambiguous: OrgSubscriptionScan = { status: "ambiguous" };

const liveEvent: OrgSubscriptionScanEvent = {
  type: "live",
  subscriptionId: "sub_live",
};
const incompleteEvent: OrgSubscriptionScanEvent = {
  type: "incomplete",
  subscriptionId: "sub_next",
};
const attemptUsedEvent: OrgSubscriptionScanEvent = { type: "attempt-used" };

const nextLive: OrgSubscriptionScan = {
  status: "live",
  subscriptionId: "sub_live",
};

test.each<
  [string, OrgSubscriptionScan, OrgSubscriptionScanEvent, OrgSubscriptionScan]
>([
  ["none + live", none, liveEvent, nextLive],
  ["used none + live", noneUsed, liveEvent, nextLive],
  ["pending + live", pending, liveEvent, nextLive],
  ["used pending + live", pendingUsed, liveEvent, nextLive],
  [
    "none + incomplete",
    none,
    incompleteEvent,
    { status: "pending", subscriptionId: "sub_next", attemptUsed: false },
  ],
  [
    "used none + incomplete",
    noneUsed,
    incompleteEvent,
    { status: "pending", subscriptionId: "sub_next", attemptUsed: true },
  ],
  ["pending + incomplete", pending, incompleteEvent, ambiguous],
  ["used pending + incomplete", pendingUsed, incompleteEvent, ambiguous],
  ["none + attempt-used", none, attemptUsedEvent, noneUsed],
  ["pending + attempt-used", pending, attemptUsedEvent, pendingUsed],
])("%s", (_name, scan, event, next) => {
  expect(transitionOrgSubscriptionScan(scan, event)).toEqual(next);
});

test.each<[string, OrgSubscriptionScan, OrgSubscriptionScanEvent]>([
  ["used none + attempt-used", noneUsed, attemptUsedEvent],
  ["used pending + attempt-used", pendingUsed, attemptUsedEvent],
  ["live + live", live, liveEvent],
  ["live + incomplete", live, incompleteEvent],
  ["live + attempt-used", live, attemptUsedEvent],
  ["ambiguous + live", ambiguous, liveEvent],
  ["ambiguous + incomplete", ambiguous, incompleteEvent],
  ["ambiguous + attempt-used", ambiguous, attemptUsedEvent],
])("%s is ignored and keeps the same state", (_name, scan, event) => {
  expect(transitionOrgSubscriptionScan(scan, event)).toBe(scan);
});

test("only live and ambiguous end the walk", () => {
  expect(
    [none, noneUsed, pending, pendingUsed, live, ambiguous].map(
      orgSubscriptionScanIsDecisive,
    ),
  ).toEqual([false, false, false, false, true, true]);
});

test("a used attempt survives a later pending subscription", () => {
  const events: OrgSubscriptionScanEvent[] = [
    attemptUsedEvent,
    incompleteEvent,
  ];
  expect(
    events.reduce(transitionOrgSubscriptionScan, initialOrgSubscriptionScan),
  ).toEqual({
    status: "pending",
    subscriptionId: "sub_next",
    attemptUsed: true,
  });
});

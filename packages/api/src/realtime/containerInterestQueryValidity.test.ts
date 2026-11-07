import { expect, test } from "bun:test";
import {
  type ContainerInterestQueryValidity,
  type ContainerInterestQueryValidityEvent,
  transitionQueryValidity,
} from "./containerInterestQueryValidity";

/** The production cap: 10,000 tracked changes. */
const CAP = 10_000;
const STALE: ContainerInterestQueryValidityEvent = { type: "marked-stale" };
const BELOW_CAP: ContainerInterestQueryValidityEvent = {
  type: "change-observed",
  pendingChanges: CAP - 1,
};
const AT_CAP: ContainerInterestQueryValidityEvent = {
  type: "change-observed",
  pendingChanges: CAP,
};

test.each<
  [
    ContainerInterestQueryValidity,
    ContainerInterestQueryValidityEvent,
    ContainerInterestQueryValidity,
  ]
>([
  ["reusable", STALE, "stale"],
  ["reusable", BELOW_CAP, "reusable"],
  ["reusable", AT_CAP, "overflowed"],
  ["stale", STALE, "stale"],
  ["stale", BELOW_CAP, "stale"],
  ["stale", AT_CAP, "overflowed"],
  ["overflowed", STALE, "overflowed"],
  ["overflowed", BELOW_CAP, "overflowed"],
  ["overflowed", AT_CAP, "overflowed"],
])("%s + %o -> %s", (state, event, next) => {
  expect(transitionQueryValidity(state, event)).toBe(next);
});

test("a reconnect after an overflow cannot make the query retryable", () => {
  const events: ContainerInterestQueryValidityEvent[] = [
    BELOW_CAP,
    AT_CAP,
    STALE,
  ];
  expect(events.reduce(transitionQueryValidity, "reusable")).toBe("overflowed");
});

import { expect, test } from "bun:test";
import { isRoutinePullHeld } from "./syncAbandon";

const pausedOrganization = (
  organizationId: string,
  direction?: "push" | "pull",
) => organizationId === "paused" && direction === "pull";

const routinePull = {
  isRemoteSyncBlocked: pausedOrganization,
  // The device has pulled this document before.
  minLsn: "0/1",
};

test("a pause holds the start of a routine pull in its organization only", () => {
  expect(isRoutinePullHeld(routinePull, "paused")).toBe(true);
  expect(isRoutinePullHeld(routinePull, "other")).toBe(false);
  expect(isRoutinePullHeld({ minLsn: "0/1" }, "paused")).toBe(false);
});

test("a first pull still runs while its organization is paused", () => {
  expect(
    isRoutinePullHeld({ isRemoteSyncBlocked: pausedOrganization }, "paused"),
  ).toBe(false);
});

test("a pull that has fetched a page runs to its end while paused", () => {
  expect(
    isRoutinePullHeld(
      {
        ...routinePull,
        pullContinuation: {
          commitLsn: "0/2",
          commitLsnMode: "tracked",
          cursor: "page-two",
        },
      },
      "paused",
    ),
  ).toBe(false);
});

test("an explicit read of raw history runs while paused", () => {
  expect(
    isRoutinePullHeld({ ...routinePull, historyMode: "raw" }, "paused"),
  ).toBe(false);
});

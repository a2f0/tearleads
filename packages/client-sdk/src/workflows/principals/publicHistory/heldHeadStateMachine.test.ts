import { expect, test } from "bun:test";
import {
  type HeldHeadEvent,
  type HeldHeadState,
  initialHeldHeadState,
  transitionHeldHeadState,
} from "./heldHeadStateMachine";

const loaded: HeldHeadEvent = { type: "heldLoaded" };
const missing: HeldHeadEvent = { type: "heldMissing" };

test("only replays and fallbacks start disabled", () => {
  expect(initialHeldHeadState(true)).toEqual({ status: "eligible" });
  expect(initialHeldHeadState(false)).toEqual({ status: "disabled" });
});

test("held head transition table", () => {
  const table: readonly [HeldHeadState, HeldHeadEvent, HeldHeadState][] = [
    [{ status: "eligible" }, loaded, { status: "heldSent" }],
    [{ status: "eligible" }, missing, { status: "eligible" }],
    // A disabled attempt never names a held state, whatever it loads.
    [{ status: "disabled" }, loaded, { status: "disabled" }],
    [{ status: "disabled" }, missing, { status: "disabled" }],
    // Once named, the attempt stays retryable with the served state.
    [{ status: "heldSent" }, loaded, { status: "heldSent" }],
    [{ status: "heldSent" }, missing, { status: "heldSent" }],
  ];
  for (const [from, event, to] of table)
    expect(transitionHeldHeadState(from, event)).toEqual(to);
});

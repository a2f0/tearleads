import { expect, test } from "bun:test";
import {
  type ContainerCreateIntentHold,
  CREATE_INTENT_HOLD_KINDS,
  NO_CREATE_INTENT_HOLD,
  parseCreateIntentHold,
  SYSTEM_SLOT_CREATE_HOLD_MS,
  serializeCreateIntentHold,
  systemSlotCreateGate,
  transitionCreateIntentHold,
} from "./createIntentHoldMachine";

const T0 = "2026-11-26T12:00:00.000Z";
const T0_MS = Date.parse(T0);

test("transitionCreateIntentHold moves cleanly across every hold state", () => {
  const held = transitionCreateIntentHold(NO_CREATE_INTENT_HOLD, {
    since: T0,
    type: "rehomedSystemSlot",
  });
  expect(held).toEqual({ since: T0, status: "awaitingParentListing" });

  // Older parent listing leaves the hold intact.
  expect(
    transitionCreateIntentHold(held, {
      checkedAt: "2026-11-26T11:59:59.000Z",
      type: "parentListingObserved",
    }),
  ).toBe(held);

  // Newer parent listing releases the hold.
  expect(
    transitionCreateIntentHold(held, {
      checkedAt: "2026-11-26T12:00:01.000Z",
      type: "parentListingObserved",
    }),
  ).toEqual(NO_CREATE_INTENT_HOLD);

  // Unexpired time keeps the hold; expiry releases it.
  expect(
    transitionCreateIntentHold(held, {
      nowMs: T0_MS + SYSTEM_SLOT_CREATE_HOLD_MS - 1,
      type: "holdExpired",
    }),
  ).toBe(held);
  expect(
    transitionCreateIntentHold(held, {
      nowMs: T0_MS + SYSTEM_SLOT_CREATE_HOLD_MS,
      type: "holdExpired",
    }),
  ).toEqual(NO_CREATE_INTENT_HOLD);

  // Taken slot and too-deep holds ignore listing observations and expiry,
  // clearing only on requeue, settlement, or real failure.
  const taken = transitionCreateIntentHold(held, { type: "slotTaken" });
  expect(taken).toEqual({ status: "slotTaken" });
  expect(
    transitionCreateIntentHold(taken, {
      checkedAt: "2026-11-26T12:05:00.000Z",
      type: "parentListingObserved",
    }),
  ).toBe(taken);
  expect(
    transitionCreateIntentHold(taken, {
      nowMs: T0_MS + SYSTEM_SLOT_CREATE_HOLD_MS * 10,
      type: "holdExpired",
    }),
  ).toBe(taken);
  expect(transitionCreateIntentHold(taken, { type: "requeued" })).toEqual(
    NO_CREATE_INTENT_HOLD,
  );

  const deep = transitionCreateIntentHold(NO_CREATE_INTENT_HOLD, {
    type: "pathTooDeep",
  });
  expect(deep).toEqual({ status: "pathTooDeep" });
  expect(transitionCreateIntentHold(deep, { type: "settled" })).toEqual(
    NO_CREATE_INTENT_HOLD,
  );
  expect(transitionCreateIntentHold(deep, { type: "failed" })).toEqual(
    NO_CREATE_INTENT_HOLD,
  );
});

test("parseCreateIntentHold and serializeCreateIntentHold round-trip every state", () => {
  const states: ContainerCreateIntentHold[] = [
    NO_CREATE_INTENT_HOLD,
    { since: T0, status: "awaitingParentListing" },
    { status: "slotTaken" },
    { status: "pathTooDeep" },
  ];
  for (const state of states) {
    const serialized = serializeCreateIntentHold(state);
    expect(
      parseCreateIntentHold({
        fallbackSince: "2026-11-26T00:00:00.000Z",
        holdKind: serialized.holdKind,
        holdSince: serialized.holdSince,
      }),
    ).toEqual(state);
  }
  expect(
    parseCreateIntentHold({
      fallbackSince: T0,
      holdKind: CREATE_INTENT_HOLD_KINDS.awaitingParentListing,
      holdSince: null,
    }),
  ).toEqual({ since: T0, status: "awaitingParentListing" });
});

test("systemSlotCreateGate releases an awaiting hold with an unparseable timestamp", () => {
  expect(
    systemSlotCreateGate({
      hold: { since: "not-a-timestamp", status: "awaitingParentListing" },
      nowMs: T0_MS,
      parentCheckedAt: null,
    }),
  ).toEqual({ status: "post" });
});

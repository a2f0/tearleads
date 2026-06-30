import { expect, test } from "bun:test";
import { shouldReArmAfterOutgoingSettlement } from "./outgoingUpdateSettlement";

test("re-arms on partial settlement progress (more remain, some settled)", () => {
  expect(
    shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount: 5,
      settledUpdateCount: 2,
    }),
  ).toBe(true);
});

test("does not re-arm when the server settled nothing (under-settle)", () => {
  // The bug this guards: a server that accepts fewer ids than were sent and
  // settles none must not drive an unbounded success-path re-arm.
  expect(
    shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount: 3,
      settledUpdateCount: 0,
    }),
  ).toBe(false);
});

test("does not re-arm once everything sent was settled", () => {
  expect(
    shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount: 5,
      settledUpdateCount: 5,
    }),
  ).toBe(false);
});

test("does not re-arm when nothing was sent", () => {
  expect(
    shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount: 0,
      settledUpdateCount: 0,
    }),
  ).toBe(false);
});

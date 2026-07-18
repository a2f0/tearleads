import { expect, test } from "bun:test";
import { shouldReArmAfterOutgoingSettlement } from "./outgoingUpdateSettlement";

test("re-arms on partial settlement progress (more remain, some settled)", () => {
  expect(
    shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount: 5,
      rekeyedUpdateCount: 0,
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
      rekeyedUpdateCount: 0,
      settledUpdateCount: 0,
    }),
  ).toBe(false);
});

test("does not re-arm once everything sent was settled", () => {
  expect(
    shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount: 5,
      rekeyedUpdateCount: 0,
      settledUpdateCount: 5,
    }),
  ).toBe(false);
});

test("does not re-arm when nothing was sent", () => {
  expect(
    shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount: 0,
      rekeyedUpdateCount: 0,
      settledUpdateCount: 0,
    }),
  ).toBe(false);
});

test("re-arms when conflicted pending updates were re-keyed", () => {
  // The fresh ids exist so the next pass can submit them; without a re-arm
  // they wait for an unrelated edit or remote event.
  expect(
    shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount: 2,
      rekeyedUpdateCount: 2,
      settledUpdateCount: 0,
    }),
  ).toBe(true);
});

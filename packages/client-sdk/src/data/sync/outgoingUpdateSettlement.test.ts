import { expect, test } from "bun:test";
import {
  MAX_CONSECUTIVE_REKEY_ONLY_PASSES,
  settleOutgoingPassAndDecideReArm,
} from "./outgoingUpdateSettlement";

test("re-arms on partial settlement progress (more remain, some settled)", () => {
  const lane = { rekeyOnlyPassCount: 0 };
  expect(
    settleOutgoingPassAndDecideReArm(lane, {
      outgoingUpdateCount: 5,
      rekeyedUpdateCount: 0,
      settledUpdateCount: 2,
    }),
  ).toBe(true);
});

test("does not re-arm when the server settled nothing (under-settle)", () => {
  // The bug this guards: a server that accepts fewer ids than were sent and
  // settles none must not drive an unbounded success-path re-arm.
  const lane = { rekeyOnlyPassCount: 0 };
  expect(
    settleOutgoingPassAndDecideReArm(lane, {
      outgoingUpdateCount: 3,
      rekeyedUpdateCount: 0,
      settledUpdateCount: 0,
    }),
  ).toBe(false);
});

test("re-arms after a synthetic recovery baseline leaves queued updates", () => {
  const lane = { rekeyOnlyPassCount: 0 };
  expect(
    settleOutgoingPassAndDecideReArm(lane, {
      outgoingUpdateCount: 3,
      rekeyedUpdateCount: 0,
      settledUpdateCount: 0,
      acceptedRecoveryBaseline: true,
    }),
  ).toBe(true);
});

test("does not re-arm once everything sent was settled", () => {
  const lane = { rekeyOnlyPassCount: 0 };
  expect(
    settleOutgoingPassAndDecideReArm(lane, {
      outgoingUpdateCount: 5,
      rekeyedUpdateCount: 0,
      settledUpdateCount: 5,
    }),
  ).toBe(false);
});

test("does not re-arm when nothing was sent", () => {
  const lane = { rekeyOnlyPassCount: 0 };
  expect(
    settleOutgoingPassAndDecideReArm(lane, {
      outgoingUpdateCount: 0,
      rekeyedUpdateCount: 0,
      settledUpdateCount: 0,
    }),
  ).toBe(false);
});

test("re-arms when conflicted pending updates were re-keyed", () => {
  // The fresh ids exist so the next pass can submit them; without a re-arm
  // they wait for an unrelated edit or remote event.
  const lane = { rekeyOnlyPassCount: 0 };
  expect(
    settleOutgoingPassAndDecideReArm(lane, {
      outgoingUpdateCount: 2,
      rekeyedUpdateCount: 2,
      settledUpdateCount: 0,
    }),
  ).toBe(true);
  expect(lane.rekeyOnlyPassCount).toBe(1);
});

test("a rekey-only loop stops self-arming once it hits the cap", () => {
  // A buggy or malicious server that keeps 409ing fresh ids (or a proxy
  // replaying cached conflict bodies) must not drive a network-speed re-key
  // loop on a lane that keeps reporting `completed`.
  const lane: { rekeyOnlyPassCount?: number } = {};
  const decisions: boolean[] = [];
  for (let pass = 0; pass < MAX_CONSECUTIVE_REKEY_ONLY_PASSES + 2; pass += 1) {
    decisions.push(
      settleOutgoingPassAndDecideReArm(lane, {
        outgoingUpdateCount: 2,
        rekeyedUpdateCount: 2,
        settledUpdateCount: 0,
      }),
    );
  }

  expect(decisions).toEqual([true, true, true, false, false]);
});

test("settlement progress resets the rekey-only counter and keeps re-arming", () => {
  const lane = { rekeyOnlyPassCount: MAX_CONSECUTIVE_REKEY_ONLY_PASSES };
  expect(
    settleOutgoingPassAndDecideReArm(lane, {
      outgoingUpdateCount: 5,
      rekeyedUpdateCount: 2,
      settledUpdateCount: 2,
    }),
  ).toBe(true);
  expect(lane.rekeyOnlyPassCount).toBe(0);
});

test("a pass without re-keys resets the rekey-only counter", () => {
  const lane = { rekeyOnlyPassCount: 2 };
  expect(
    settleOutgoingPassAndDecideReArm(lane, {
      outgoingUpdateCount: 3,
      rekeyedUpdateCount: 0,
      settledUpdateCount: 0,
    }),
  ).toBe(false);
  expect(lane.rekeyOnlyPassCount).toBe(0);
});

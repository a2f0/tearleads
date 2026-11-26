import { expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import {
  type CreditedHistoryUpdate,
  creditDocumentHistoryUpdates,
} from "./documentHistoryProvenance";

const ALICE = "11";
const BOB = "222";

function update(
  updateId: string,
  start: Record<string, number>,
  end: Record<string, number>,
  overrides: Partial<CreditedHistoryUpdate> = {},
): CreditedHistoryUpdate {
  return {
    authorityKind: "direct",
    createdAt: `2026-11-25T00:00:0${updateId.length}.000Z`,
    partialEndVersionVector: encodeVersionVectorCounters(end),
    partialStartVersionVector: encodeVersionVectorCounters(start),
    signedAt: "2026-11-25T00:00:00.000Z",
    updateId,
    writerKeyFingerprint: `${updateId}-key`,
    writerUserId: `${updateId}-user`,
    ...overrides,
  };
}

const credit = (updates: readonly CreditedHistoryUpdate[]) =>
  creditDocumentHistoryUpdates(updates).map((range) => [
    range.peerId,
    range.startCounter,
    range.endCounter,
    range.updateId,
    range.authorityKind,
  ]);

test("each operation is credited to the first accepted update that carried it", () => {
  expect(
    credit([
      update("a", {}, { [ALICE]: 3 }),
      // Carries Alice's operations again, and two of its own.
      update("bb", {}, { [ALICE]: 3, [BOB]: 2 }),
      update("ccc", { [ALICE]: 3 }, { [ALICE]: 5 }),
    ]),
  ).toEqual([
    [ALICE, 0, 3, "a", "direct"],
    [ALICE, 3, 5, "ccc", "direct"],
    [BOB, 0, 2, "bb", "direct"],
  ]);
});

test("a baseline is credited only with operations no earlier update carried", () => {
  const ranges = creditDocumentHistoryUpdates([
    update("a", {}, { [ALICE]: 2 }),
    update("base", {}, { [ALICE]: 4, [BOB]: 1 }, { authorityKind: "baseline" }),
    // An ordinary update served after the baseline does not take them back.
    update("late", { [ALICE]: 2 }, { [ALICE]: 6 }),
  ]);

  expect(
    ranges.map((range) => [
      range.peerId,
      range.startCounter,
      range.endCounter,
      range.updateId,
      range.authorityKind,
    ]),
  ).toEqual([
    [ALICE, 0, 2, "a", "direct"],
    [ALICE, 2, 4, "base", "baseline"],
    [ALICE, 4, 6, "late", "direct"],
    [BOB, 0, 1, "base", "baseline"],
  ]);
  expect(ranges[1]).toMatchObject({
    createdAt: "2026-11-25T00:00:04.000Z",
    signedAt: "2026-11-25T00:00:00.000Z",
    writerKeyFingerprint: "base-key",
    writerUserId: "base-user",
  });
});

test("an update that fills a gap between covered runs is credited with the gap", () => {
  expect(
    credit([
      update("a", {}, { [ALICE]: 2 }),
      update("bb", { [ALICE]: 5 }, { [ALICE]: 7 }),
      update("ccc", { [ALICE]: 1 }, { [ALICE]: 9 }),
    ]),
  ).toEqual([
    [ALICE, 0, 2, "a", "direct"],
    [ALICE, 2, 5, "ccc", "direct"],
    [ALICE, 5, 7, "bb", "direct"],
    [ALICE, 7, 9, "ccc", "direct"],
  ]);
});

test("peers are ordered numerically and no update yields no range", () => {
  expect(creditDocumentHistoryUpdates([])).toEqual([]);
  expect(
    credit([update("a", {}, { [BOB]: 1 }), update("bb", {}, { [ALICE]: 1 })]),
  ).toEqual([
    [ALICE, 0, 1, "bb", "direct"],
    [BOB, 0, 1, "a", "direct"],
  ]);
});

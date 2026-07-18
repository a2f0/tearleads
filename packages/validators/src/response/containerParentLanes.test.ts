import { expect, test } from "bun:test";
import { isListContainerParentLanesResponse } from "./containerParentLanes";

function page(overrides: Record<string, unknown> = {}) {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
    ...overrides,
  };
}

function result(
  laneId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { laneId, page: page(), ...overrides };
}

test("accepts one through four strict container parent lane results", () => {
  expect(
    isListContainerParentLanesResponse({ results: [result("root")] }),
  ).toBe(true);
  expect(
    isListContainerParentLanesResponse({
      results: Array.from({ length: 4 }, (_, index) => result(`lane-${index}`)),
    }),
  ).toBe(true);

  expect(isListContainerParentLanesResponse({ results: [] })).toBe(false);
  expect(
    isListContainerParentLanesResponse({
      results: Array.from({ length: 5 }, (_, index) => result(`lane-${index}`)),
    }),
  ).toBe(false);
});

test("rejects unknown or duplicate result fields", () => {
  expect(
    isListContainerParentLanesResponse({
      results: [result("root")],
      unknown: true,
    }),
  ).toBe(false);
  expect(
    isListContainerParentLanesResponse({
      results: [result("root", { unknown: true })],
    }),
  ).toBe(false);
  expect(
    isListContainerParentLanesResponse({
      results: [result("same"), result("same")],
    }),
  ).toBe(false);
});

test("rejects malformed lane ids and list-container pages", () => {
  expect(isListContainerParentLanesResponse({ results: [result("")] })).toBe(
    false,
  );
  expect(
    isListContainerParentLanesResponse({
      results: [result("a".repeat(65))],
    }),
  ).toBe(false);
  expect(
    isListContainerParentLanesResponse({
      results: [result("root", { page: { hasMore: false, items: [] } })],
    }),
  ).toBe(false);
});

test("preserves the existing list-container page extension behavior", () => {
  expect(
    isListContainerParentLanesResponse({
      results: [
        result("root", { page: page({ futureListContainersField: true }) }),
      ],
    }),
  ).toBe(true);
});

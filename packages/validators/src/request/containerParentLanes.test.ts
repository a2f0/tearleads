import { expect, test } from "bun:test";
import {
  isListContainerParentLanesRequest,
  ListContainerParentLanesRequestSchema,
} from "./containerParentLanes";

const ROOT_PARENT_ID = "550e8400-e29b-41d4-a716-446655440000";

function lane(
  laneId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    laneId,
    parentId: ROOT_PARENT_ID,
    watermark: null,
    ...overrides,
  };
}

test("accepts one through four strict container parent lanes", () => {
  expect(
    isListContainerParentLanesRequest({
      lanes: [
        lane("root", {
          parentId: null,
          watermark: {
            id: "watermark-1",
            updatedAt: "2026-07-18T12:00:00.000Z",
          },
        }),
      ],
    }),
  ).toBe(true);
  expect(
    isListContainerParentLanesRequest({
      lanes: Array.from({ length: 4 }, (_, index) => lane(`lane-${index}`)),
    }),
  ).toBe(true);

  expect(isListContainerParentLanesRequest({ lanes: [] })).toBe(false);
  expect(
    isListContainerParentLanesRequest({
      lanes: Array.from({ length: 5 }, (_, index) => lane(`lane-${index}`)),
    }),
  ).toBe(false);
});

test("rejects unknown container parent lane request fields", () => {
  expect(
    isListContainerParentLanesRequest({
      lanes: [lane("root")],
      unknown: true,
    }),
  ).toBe(false);
  expect(
    isListContainerParentLanesRequest({
      lanes: [lane("root", { unknown: true })],
    }),
  ).toBe(false);
  expect(
    isListContainerParentLanesRequest({
      lanes: [
        lane("root", {
          watermark: {
            id: "watermark-1",
            updatedAt: "2026-07-18T12:00:00.000Z",
            unknown: true,
          },
        }),
      ],
    }),
  ).toBe(false);
});

test("rejects duplicate or malformed container parent lane ids", () => {
  expect(
    isListContainerParentLanesRequest({
      lanes: [lane("same"), lane("same")],
    }),
  ).toBe(false);
  expect(isListContainerParentLanesRequest({ lanes: [lane("")] })).toBe(false);
  expect(
    isListContainerParentLanesRequest({ lanes: [lane("a".repeat(65))] }),
  ).toBe(false);
});

test("rejects malformed parent ids and watermarks", () => {
  expect(
    isListContainerParentLanesRequest({
      lanes: [lane("root", { parentId: "not-a-uuid" })],
    }),
  ).toBe(false);
  expect(
    isListContainerParentLanesRequest({
      lanes: [
        lane("root", {
          parentId: "550e8400-e29b-11d4-a716-446655440000",
        }),
      ],
    }),
  ).toBe(false);
  expect(
    isListContainerParentLanesRequest({
      lanes: [
        lane("root", {
          watermark: { id: "", updatedAt: "2026-07-18T12:00:00.000Z" },
        }),
      ],
    }),
  ).toBe(false);
  expect(
    isListContainerParentLanesRequest({
      lanes: [
        lane("root", {
          watermark: { id: "watermark-1", updatedAt: "not-a-date" },
        }),
      ],
    }),
  ).toBe(false);
});

test("oversized malformed lane batches abort before composed refinements", () => {
  const request = { lanes: Array.from({ length: 5 }, () => null) };

  expect(() =>
    ListContainerParentLanesRequestSchema.safeParse(request),
  ).not.toThrow();
  expect(isListContainerParentLanesRequest(request)).toBe(false);
});

test("bounds per-lane and aggregate requested pages", () => {
  expect(
    isListContainerParentLanesRequest({
      lanes: [lane("root", { limit: 500 })],
    }),
  ).toBe(true);
  for (const limit of [0, 1.5, 501]) {
    expect(
      isListContainerParentLanesRequest({
        lanes: [lane("root", { limit })],
      }),
    ).toBe(false);
  }

  expect(
    isListContainerParentLanesRequest({
      lanes: [lane("one", { limit: 300 }), lane("two", { limit: 200 })],
    }),
  ).toBe(true);
  const result = ListContainerParentLanesRequestSchema.safeParse({
    lanes: [lane("one", { limit: 401 }), lane("two")],
  });
  expect(result.success).toBe(false);
});

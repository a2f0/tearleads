import { expect, test } from "bun:test";
import { parseOptionalWatermark } from "./queryParams";

test("parseOptionalWatermark accepts an absent watermark", () => {
  expect(parseOptionalWatermark(undefined, undefined)).toBeUndefined();
});

test("parseOptionalWatermark preserves complete and partial watermarks", () => {
  expect(
    parseOptionalWatermark("2026-08-06T12:00:00.000Z", "document-1"),
  ).toEqual({
    id: "document-1",
    updatedAt: "2026-08-06T12:00:00.000Z",
  });
  expect(parseOptionalWatermark("2026-08-06T12:00:00.000Z", undefined)).toEqual(
    {
      id: "",
      updatedAt: "2026-08-06T12:00:00.000Z",
    },
  );
  expect(parseOptionalWatermark(undefined, "document-1")).toEqual({
    id: "document-1",
    updatedAt: "",
  });
});

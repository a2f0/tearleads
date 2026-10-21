import { expect, test } from "bun:test";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import {
  formatSourceLastModified,
  readDimensions,
  readDuration,
} from "./fileDocumentReadFields";

test("source modified times show as a date for ISO text and epoch milliseconds", () => {
  const iso = "2026-09-20T17:00:00.000Z";
  expect(formatSourceLastModified(iso)).toBe(formatMiniAppDateTime(iso));
  expect(formatSourceLastModified("1789952400000")).toBe(
    formatMiniAppDateTime(1_789_952_400_000),
  );
  expect(formatSourceLastModified("1789952400000")).not.toContain(
    "1789952400000",
  );
  expect(formatSourceLastModified("  ")).toBe("");
});

test("dimensions join width and height, and need both", () => {
  expect(readDimensions({ height: "1024", width: "1536" })).toBe("1536 × 1024");
  expect(readDimensions({ width: "1536" })).toBe("");
  expect(readDimensions({ height: "0", width: "1536" })).toBe("");
  expect(readDimensions({ height: "tall", width: "1536" })).toBe("");
});

test("durations read as a clock", () => {
  expect(readDuration({ durationMs: "187000" })).toBe("3:07");
  expect(readDuration({ durationMs: "999" })).toBe("0:01");
  expect(readDuration({ durationMs: "3729000" })).toBe("1:02:09");
  expect(readDuration({ durationMs: "" })).toBe("");
  expect(readDuration({})).toBe("");
});

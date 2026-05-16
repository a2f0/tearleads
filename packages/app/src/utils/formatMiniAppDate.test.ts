import { expect, test } from "bun:test";
import { formatMiniAppDate, formatMiniAppDateTime } from "./formatMiniAppDate";

test("formatMiniAppDate formats date-only values consistently", () => {
  expect(
    formatMiniAppDate("2026-05-15T12:10:00.000Z", {
      locale: "en-US",
      timeZone: "UTC",
    }),
  ).toBe("May 15, 2026");
});

test("formatMiniAppDateTime formats date-time values consistently", () => {
  expect(
    formatMiniAppDateTime("2026-05-15T12:10:00.000Z", {
      locale: "en-US",
      timeZone: "UTC",
    }),
  ).toBe("May 15, 2026, 12:10 PM");
});

test("mini-app date formatting handles empty and invalid values", () => {
  expect(formatMiniAppDateTime(null)).toBe("Unknown");
  expect(formatMiniAppDateTime("", { emptyFallback: "-" })).toBe("-");
  expect(formatMiniAppDateTime("not-a-date")).toBe("not-a-date");
});

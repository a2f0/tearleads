import { expect, test } from "bun:test";
import { seedTrackerRow } from "./seedTrackerRows";

test("seed tracker times preserve the recorded wall clock across offsets", () => {
  for (const offset of ["-07:00", "+05:30", "Z", ""]) {
    expect(
      seedTrackerRow({
        measuredAt: `2026-09-03T07:30:00${offset}`,
        weight: "61.4",
        unit: "kg",
      }),
    ).toEqual({
      measuredAt: "2026-09-03T07:30:00",
      weight: "61.4",
      unit: "kg",
    });
  }
});

test("seed tracker times reject missing, invalid and normalized-overflow dates", () => {
  for (const measuredAt of [
    "",
    "2026-02-30T07:30:00-07:00",
    "2026-09-03T07:30:00+25:00",
    "2026-09-03",
  ]) {
    expect(() => seedTrackerRow({ measuredAt })).toThrow(
      "Invalid seed tracker measurement time",
    );
  }
});

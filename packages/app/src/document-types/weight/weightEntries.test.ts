import { expect, test } from "bun:test";
import type { WeightEntryRow } from "./weightEntries";
import { formatWeightChange } from "./weightEntries";

function makeEntry(weight: string): WeightEntryRow {
  return {
    id: `e-${weight}`,
    weight,
    measuredAt: "",
    notes: "",
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    fieldEditors: {},
  };
}

test("change is the signed delta from the previous entry", () => {
  expect(formatWeightChange(makeEntry("179"), makeEntry("180.5"), "lb")).toBe(
    "−1.5 lb",
  );
  expect(formatWeightChange(makeEntry("182.25"), makeEntry("180"), "lb")).toBe(
    "+2.25 lb",
  );
  expect(formatWeightChange(makeEntry("180"), makeEntry("180"), "kg")).toBe(
    "±0 kg",
  );
});

test("no change is reported without a previous entry", () => {
  expect(formatWeightChange(makeEntry("180"), undefined, "lb")).toBeNull();
});

test("no change is reported when either side is not a valid measurement", () => {
  // Number.parseFloat would read "180abc" as 180 and report a bogus delta.
  expect(formatWeightChange(makeEntry("180abc"), makeEntry("180"), "lb")).toBe(
    null,
  );
  expect(formatWeightChange(makeEntry("179"), makeEntry("180abc"), "lb")).toBe(
    null,
  );
  expect(formatWeightChange(makeEntry("8000"), makeEntry("180"), "lb")).toBe(
    null,
  );
  expect(formatWeightChange(makeEntry(""), makeEntry("180"), "lb")).toBeNull();
});

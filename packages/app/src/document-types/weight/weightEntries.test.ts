import { expect, test } from "bun:test";
import type { WeightUnit } from "./weightDocumentDefinition";
import type { WeightEntryRow } from "./weightEntries";
import { formatWeight, formatWeightChange } from "./weightEntries";

function makeEntry(weight: string, unit: WeightUnit = "lb"): WeightEntryRow {
  return {
    id: `e-${weight}-${unit}`,
    weight,
    unit,
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

test("a weight renders in the unit its own entry recorded", () => {
  expect(formatWeight(makeEntry("180.5"))).toBe("180.5 lb");
  expect(formatWeight(makeEntry("82", "kg"))).toBe("82 kg");
  expect(formatWeight(makeEntry(""))).toBe("None");
});

test("change is the signed delta from the previous entry", () => {
  expect(formatWeightChange(makeEntry("179"), makeEntry("180.5"))).toBe(
    "−1.5 lb",
  );
  expect(formatWeightChange(makeEntry("182.25"), makeEntry("180"))).toBe(
    "+2.25 lb",
  );
  expect(formatWeightChange(makeEntry("82", "kg"), makeEntry("82", "kg"))).toBe(
    "±0 kg",
  );
});

test("no change is reported without a previous entry", () => {
  expect(formatWeightChange(makeEntry("180"), undefined)).toBeNull();
});

test("no change is reported across entries recorded in different units", () => {
  // Comparing them would need a conversion, putting a number on screen that
  // nobody actually weighed.
  expect(
    formatWeightChange(makeEntry("82", "kg"), makeEntry("180", "lb")),
  ).toBeNull();
});

test("no change is reported when either side is not a valid measurement", () => {
  // Number.parseFloat would read "180abc" as 180 and report a bogus delta.
  expect(formatWeightChange(makeEntry("180abc"), makeEntry("180"))).toBeNull();
  expect(formatWeightChange(makeEntry("179"), makeEntry("180abc"))).toBeNull();
  expect(formatWeightChange(makeEntry("8000"), makeEntry("180"))).toBeNull();
  expect(formatWeightChange(makeEntry(""), makeEntry("180"))).toBeNull();
});

import { expect, test } from "bun:test";
import type { WeightEntryRow } from "./weightEntries";
import { convertWeightValue, formatWeightChange } from "./weightEntries";

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

test("converts stored measurements between units", () => {
  expect(convertWeightValue("180", "lb", "kg")).toBe("81.65");
  expect(convertWeightValue("100", "kg", "lb")).toBe("220.46");
  // Rounding to the two decimals the editor accepts means a round trip can land
  // a hundredth off — accepted deliberately over storing unenterable precision.
  expect(convertWeightValue("81.65", "kg", "lb")).toBe("180.01");
});

test("conversion leaves a cell alone when it cannot be restated", () => {
  // Same unit: nothing to do.
  expect(convertWeightValue("180", "lb", "lb")).toBeNull();
  // Blank, half-typed, and out-of-range values are the user's to fix — rewriting
  // them would turn a visible validation error into silently altered data.
  expect(convertWeightValue("", "lb", "kg")).toBeNull();
  expect(convertWeightValue("  ", "lb", "kg")).toBeNull();
  expect(convertWeightValue("180abc", "lb", "kg")).toBeNull();
  expect(convertWeightValue("8000", "lb", "kg")).toBeNull();
});

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

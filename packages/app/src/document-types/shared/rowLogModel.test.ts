import { expect, test } from "bun:test";
import {
  formatValueWithUnit,
  isValidAmount,
  isValidCurrencyCode,
  isValidReading,
} from "./documentValueFormats";
import {
  getRowLogCellIssue,
  getRowLogFieldIssue,
  isRowLogEntryComplete,
  type RowLogField,
} from "./rowLogModel";

const fields: ReadonlyArray<RowLogField> = [
  { input: "date", key: "day", label: "Day" },
  { input: "datetime-local", key: "at", label: "At" },
  {
    input: "select",
    key: "unit",
    label: "Unit",
    options: [{ label: "mi", value: "mi" }],
  },
  {
    format: { isValid: isValidAmount, message: "Bad amount." },
    input: "decimal",
    key: "cost",
    label: "Cost",
  },
  { input: "text", key: "work", label: "Work", required: true },
];

function field(key: string): RowLogField {
  const found = fields.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`missing field ${key}`);
  return found;
}

test("each input kind accepts blanks and rejects malformed values", () => {
  expect(getRowLogFieldIssue(field("day"), "")).toBeNull();
  expect(getRowLogFieldIssue(field("day"), "2026-02-29")).not.toBeNull();
  expect(getRowLogFieldIssue(field("day"), "2028-02-29")).toBeNull();
  expect(getRowLogFieldIssue(field("at"), "2026-07-16T08:30")).toBeNull();
  expect(getRowLogFieldIssue(field("at"), "2026-07-16 08:30")).not.toBeNull();
  expect(getRowLogFieldIssue(field("at"), "2026-07-16T24:00")).not.toBeNull();
  expect(getRowLogFieldIssue(field("at"), "2026-07-16T23:60")).not.toBeNull();
  expect(getRowLogFieldIssue(field("unit"), "km")).toBe("Expected one of mi.");
  expect(getRowLogFieldIssue(field("cost"), "12.5")).toBeNull();
  expect(getRowLogFieldIssue(field("cost"), "$12")).toBe("Bad amount.");
});

test("a stored cell's issue adds a blank required cell to the format checks", () => {
  expect(getRowLogCellIssue(field("work"), " ")).toBe("Expected a value.");
  expect(getRowLogCellIssue(field("work"), "Tires")).toBeNull();
  // An optional blank cell is fine; a filled one is checked as before.
  expect(getRowLogCellIssue(field("cost"), "")).toBeNull();
  expect(getRowLogCellIssue(field("cost"), "$12")).toBe("Bad amount.");
});

test("a new row needs its required cells and no malformed ones", () => {
  expect(isRowLogEntryComplete(fields, { work: "" })).toBe(false);
  expect(isRowLogEntryComplete(fields, { work: "Tires" })).toBe(true);
  expect(isRowLogEntryComplete(fields, { cost: "x", work: "Tires" })).toBe(
    false,
  );
});

test("amounts, currency codes, and readings follow one stored convention", () => {
  expect(isValidAmount("1234.567")).toBe(true);
  expect(isValidAmount("1,234")).toBe(false);
  expect(isValidAmount("-5")).toBe(false);
  expect(isValidCurrencyCode("EUR")).toBe(true);
  expect(isValidCurrencyCode("eur")).toBe(false);
  expect(isValidReading("45120.5")).toBe(true);
  expect(isValidReading("45 120")).toBe(false);
  expect(formatValueWithUnit("89.99", "USD")).toBe("89.99 USD");
  expect(formatValueWithUnit("45120", "")).toBe("45120");
  // A unit without a value reads as absent, not as a bare "mi".
  expect(formatValueWithUnit(" ", "mi")).toBe("");
});

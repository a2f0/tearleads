import { expect, test } from "bun:test";
import type {
  DocumentProjection,
  DocumentRowSummary,
} from "@tearleads/client-sdk";
import {
  isValidWeightMeasurement,
  toWeightUnit,
  weightDocumentProjectorDefinition,
} from "./weightDocumentDefinition";

function project(
  structuredFields: Record<string, string>,
  rows: DocumentRowSummary[],
): DocumentProjection {
  const projector = weightDocumentProjectorDefinition.project;
  if (!projector) {
    throw new Error("weight projector is not defined");
  }
  return projector({
    documentKind: "weight",
    structuredFields,
    text: "",
    rows,
  });
}

function entry(id: string, fields: Record<string, string>): DocumentRowSummary {
  return { id, fields };
}

test("weight measurements validate against a plausible range", () => {
  expect(isValidWeightMeasurement("180")).toBe(true);
  expect(isValidWeightMeasurement("180.5")).toBe(true);
  expect(isValidWeightMeasurement("180.25")).toBe(true);
  expect(isValidWeightMeasurement("1")).toBe(true);
  expect(isValidWeightMeasurement("1500")).toBe(true);
  expect(isValidWeightMeasurement("0")).toBe(false);
  expect(isValidWeightMeasurement("1501")).toBe(false);
  // Three decimals exceed what the input accepts, so they are not silently kept.
  expect(isValidWeightMeasurement("180.255")).toBe(false);
  expect(isValidWeightMeasurement("-5")).toBe(false);
  expect(isValidWeightMeasurement("abc")).toBe(false);
  expect(isValidWeightMeasurement("")).toBe(false);
});

test("unit falls back to pounds when absent or unrecognized", () => {
  expect(toWeightUnit("kg")).toBe("kg");
  expect(toWeightUnit(" lb ")).toBe("lb");
  expect(toWeightUnit("stone")).toBe("lb");
  expect(toWeightUnit(undefined)).toBe("lb");
  expect(toWeightUnit("")).toBe("lb");
});

test("title uses the tracker name when present", () => {
  const projection = project({ trackerName: "Cut 2026", unit: "kg" }, [
    entry("e1", { weight: "82.5" }),
  ]);

  expect(projection.title).toBe("Cut 2026");
  expect(projection.structuredFields).toEqual({
    trackerName: "Cut 2026",
    unit: "kg",
  });
  expect(projection.fieldValidationIssues).toEqual([]);
});

test("title defaults to the document type name when unnamed, even with entries", () => {
  const projection = project({ trackerName: "" }, [
    entry("e1", { weight: "180" }),
    entry("e2", { weight: "" }),
  ]);

  expect(projection.title).toBe("Weight Tracker");
});

test("title remains the document type name with multiple unnamed entries", () => {
  const projection = project({ trackerName: "" }, [
    entry("e1", { weight: "180" }),
    entry("e2", { weight: "179" }),
  ]);

  expect(projection.title).toBe("Weight Tracker");
});

test("title defaults to the document type name with no entries", () => {
  expect(project({ trackerName: "" }, []).title).toBe("Weight Tracker");
});

test("out-of-range weights surface as validation issues", () => {
  const projection = project({ trackerName: "" }, [
    entry("e1", { weight: "8000" }),
    entry("e2", { weight: "abc" }),
  ]);

  expect(projection.fieldValidationIssues).toEqual([
    {
      field: "rows[0].weight",
      message: "Expected a weight between 1 and 1500.",
      value: "8000",
    },
    {
      field: "rows[1].weight",
      message: "Expected a weight between 1 and 1500.",
      value: "abc",
    },
  ]);
});

test("an unrecognized unit surfaces as a validation issue", () => {
  const projection = project({ trackerName: "", unit: "stone" }, []);

  expect(projection.fieldValidationIssues).toEqual([
    {
      field: "unit",
      message: "Expected one of lb, kg.",
      value: "stone",
    },
  ]);
});

test("an entry's own unit is validated too", () => {
  // Entries carry the unit they were recorded in, so a peer writing a bogus one
  // is reported per row rather than silently read as the tracker default.
  const projection = project({ trackerName: "" }, [
    entry("e1", { weight: "180", unit: "kg" }),
    entry("e2", { weight: "82", unit: "stone" }),
  ]);

  expect(projection.fieldValidationIssues).toEqual([
    {
      field: "rows[1].unit",
      message: "Expected one of lb, kg.",
      value: "stone",
    },
  ]);
});

import { expect, test } from "bun:test";
import type {
  DocumentProjection,
  DocumentRowSummary,
} from "@tearleads/client-sdk";
import {
  bloodPressureDocumentProjectorDefinition,
  isValidBloodPressureMeasurement,
} from "./bloodPressureDocumentDefinition";

function project(
  structuredFields: Record<string, string>,
  rows: DocumentRowSummary[],
): DocumentProjection {
  const projector = bloodPressureDocumentProjectorDefinition.project;
  if (!projector) {
    throw new Error("blood pressure projector is not defined");
  }
  return projector({
    documentKind: "blood_pressure",
    structuredFields,
    text: "",
    rows,
  });
}

function reading(
  id: string,
  fields: Record<string, string>,
): DocumentRowSummary {
  return { id, fields };
}

test("blood pressure measurements validate against a plausible range", () => {
  expect(isValidBloodPressureMeasurement("120")).toBe(true);
  expect(isValidBloodPressureMeasurement("400")).toBe(true);
  expect(isValidBloodPressureMeasurement("1")).toBe(true);
  expect(isValidBloodPressureMeasurement("0")).toBe(false);
  expect(isValidBloodPressureMeasurement("401")).toBe(false);
  expect(isValidBloodPressureMeasurement("1200")).toBe(false);
  expect(isValidBloodPressureMeasurement("abc")).toBe(false);
  expect(isValidBloodPressureMeasurement("")).toBe(false);
});

test("title uses the tracker name when present", () => {
  const projection = project({ trackerName: "Home log" }, [
    reading("r1", { systolic: "120", diastolic: "80" }),
  ]);

  expect(projection.title).toBe("Home log");
  expect(projection.structuredFields).toEqual({ trackerName: "Home log" });
  expect(projection.fieldValidationIssues).toEqual([]);
});

test("title defaults to the document type name when unnamed, even with readings", () => {
  const projection = project({ trackerName: "" }, [
    reading("r1", { systolic: "121", diastolic: "79" }),
    reading("r2", { systolic: "", diastolic: "" }),
  ]);

  expect(projection.title).toBe("Blood Pressure Tracker");
});

test("title defaults to the document type name with no readings", () => {
  expect(project({ trackerName: "" }, []).title).toBe("Blood Pressure Tracker");
});

test("out-of-range measurements surface as validation issues", () => {
  const projection = project({ trackerName: "" }, [
    reading("r1", { systolic: "1200", diastolic: "80", pulse: "abc" }),
  ]);

  expect(projection.fieldValidationIssues).toEqual([
    {
      field: "rows[0].systolic",
      message: "Expected a systolic between 1 and 400.",
      value: "1200",
    },
    {
      field: "rows[0].pulse",
      message: "Expected a pulse between 1 and 400.",
      value: "abc",
    },
  ]);
});

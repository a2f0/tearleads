import { expect, test } from "bun:test";
import {
  type DocumentProjection,
  type DocumentRowSummary,
  initializeStoredDocumentKind,
  readStoredDocumentState,
  writeStoredDocumentFields,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS as projectors } from "../projectors";
import {
  MEDICATION_DOCUMENT_KIND,
  medicationDocumentProjectorDefinition,
} from "./medicationDocumentDefinition";
import { MEDICATION_INTAKE_LOG } from "./medicationIntakeLog";

function project(
  structuredFields: Record<string, string>,
  rows: DocumentRowSummary[] = [],
): DocumentProjection {
  return medicationDocumentProjectorDefinition.project({
    documentKind: MEDICATION_DOCUMENT_KIND,
    rows,
    structuredFields,
    text: "",
  });
}

test("a medication snapshot keeps what was prescribed", async () => {
  const doc = await createDocument("medication");
  initializeStoredDocumentKind(doc, MEDICATION_DOCUMENT_KIND, projectors);
  expect(readStoredDocumentState(doc, projectors).title).toBe(
    "Untitled medication",
  );
  const fields = {
    medicationName: "Lisinopril",
    strength: "10 mg",
    dosageForm: "Tablet",
    directions: "Take 1 tablet by mouth once daily",
    patientName: "Ada Lovelace",
    prescriber: "Dr. Rivera",
    pharmacy: "Main Street Pharmacy",
    prescriptionNumber: "RX-448812",
    startDate: "2026-01-05",
    endDate: "2026-07-05",
  };
  writeStoredDocumentFields(doc, MEDICATION_DOCUMENT_KIND, fields, projectors);
  const restored = await createDocument("restored-medication");
  restored.import(doc.export({ mode: "snapshot" }));
  expect(readStoredDocumentState(restored, projectors)).toMatchObject({
    documentKind: MEDICATION_DOCUMENT_KIND,
    fieldValidationIssues: [],
    structuredFields: fields,
    title: "Lisinopril 10 mg",
  });
});

test("the title is the name with its strength, and a strength alone is untitled", () => {
  expect(project({ medicationName: "Metformin" }).title).toBe("Metformin");
  expect(project({ strength: "500 mg" }).title).toBe("Untitled medication");
});

test("dates must be calendar dates and the end cannot precede the start", () => {
  expect(project({}).fieldValidationIssues).toEqual([]);
  expect(
    project({ endDate: "2026-02-30", startDate: "soon" }).fieldValidationIssues,
  ).toEqual([
    {
      field: "startDate",
      message: "Expected a calendar date in YYYY-MM-DD format.",
      value: "soon",
    },
    {
      field: "endDate",
      message: "Expected a calendar date in YYYY-MM-DD format.",
      value: "2026-02-30",
    },
  ]);
  expect(
    project({ endDate: "2026-01-04", startDate: "2026-01-05" })
      .fieldValidationIssues,
  ).toEqual([
    {
      field: "endDate",
      message: "Expected an end date on or after the start date.",
      value: "2026-01-04",
    },
  ]);
  expect(
    project({ endDate: "2026-01-05", startDate: "2026-01-05" })
      .fieldValidationIssues,
  ).toEqual([]);
});

test("intake rows need a real local time, and the dose carries forward", () => {
  expect(
    project({ medicationName: "Lisinopril" }, [
      { fields: { dose: "1 tablet", takenAt: "2026-07-16T08:30" }, id: "d1" },
      { fields: { dose: "1 tablet", takenAt: "2026-07-16T24:00" }, id: "d2" },
      // The time is required; a blank optional amount is not an issue.
      { fields: { dose: "" }, id: "d3" },
    ]).fieldValidationIssues,
  ).toEqual([
    {
      field: "rows[1].takenAt",
      message: "Expected a local date and time in YYYY-MM-DDTHH:MM format.",
      value: "2026-07-16T24:00",
    },
    { field: "rows[2].takenAt", message: "Expected a value.", value: "" },
  ]);

  const seeded = MEDICATION_INTAKE_LOG.createEntry([
    { dose: "2 tablets", takenAt: "2026-07-16T08:30" },
  ]);
  expect(seeded).toEqual({
    dose: "2 tablets",
    takenAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u),
  });
});

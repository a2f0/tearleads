import { expect, test } from "bun:test";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
  writeStoredDocumentFields,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS as projectors } from "../projectors";
import { readPrescriptionFields } from "./eyeglassPrescriptionDocumentDefinition";

test("a prescription snapshot keeps each eye's notation and the split PD", async () => {
  const doc = await createDocument("prescription");
  const kind = "eyeglass_prescription";
  initializeStoredDocumentKind(doc, kind, projectors);
  expect(readStoredDocumentState(doc, projectors).title).toBe(
    "Untitled eyeglass prescription",
  );
  const fields = {
    patientName: "Alex Rivera",
    prescriber: "Dr. Lee",
    dateIssued: "2026-01-01",
    expirationDate: "2027-01-01",
    rightSphere: "PL",
    rightCylinder: "-0.50",
    rightAxis: "005",
    rightAdd: "+1.25",
    rightPrism: "1 BI",
    leftSphere: "+1.00",
    leftCylinder: "-0.25",
    leftAxis: "175",
    leftAdd: "+1.50",
    leftPrism: "2 BU",
    pupillaryDistance: "31 / 32",
  };
  writeStoredDocumentFields(doc, kind, fields, projectors);
  const restored = await createDocument("restored-prescription");
  restored.import(doc.export({ mode: "snapshot" }));
  expect(readStoredDocumentState(restored, projectors)).toMatchObject({
    documentKind: kind,
    structuredFields: fields,
    title: "Eyeglass Prescription Alex Rivera · 2026-01-01",
    fieldValidationIssues: [],
  });
});

test("partial prescriptions accept blank values and flag malformed stored fields", () => {
  expect(readPrescriptionFields({}).issues).toEqual([]);
  expect(
    readPrescriptionFields({
      dateIssued: "2026-02-29",
      expirationDate: "tomorrow",
      rightAxis: 5,
    }).issues.map((issue) => issue.field),
  ).toEqual(["dateIssued", "expirationDate", "rightAxis"]);
});

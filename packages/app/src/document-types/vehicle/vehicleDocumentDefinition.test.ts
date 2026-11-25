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
  VEHICLE_DOCUMENT_KIND,
  vehicleDocumentProjectorDefinition,
} from "./vehicleDocumentDefinition";

function project(
  structuredFields: Record<string, string>,
  rows: DocumentRowSummary[] = [],
): DocumentProjection {
  return vehicleDocumentProjectorDefinition.project({
    documentKind: VEHICLE_DOCUMENT_KIND,
    rows,
    structuredFields,
    text: "",
  });
}

test("a vehicle snapshot keeps its registration and purchase details", async () => {
  const doc = await createDocument("vehicle");
  initializeStoredDocumentKind(doc, VEHICLE_DOCUMENT_KIND, projectors);
  expect(readStoredDocumentState(doc, projectors).title).toBe(
    "Untitled vehicle",
  );
  const fields = {
    year: "2021",
    make: "Toyota",
    model: "RAV4",
    vin: "JTMW1RFV0MD012345",
    licensePlate: "8ABC123",
    registrationRegion: "CA",
    registrationExpirationDate: "2027-03-31",
    purchaseDate: "2021-04-02",
    purchasePrice: "28450.00",
    purchaseCurrency: "USD",
    seller: "Valley Toyota",
  };
  writeStoredDocumentFields(doc, VEHICLE_DOCUMENT_KIND, fields, projectors);
  const restored = await createDocument("restored-vehicle");
  restored.import(doc.export({ mode: "snapshot" }));
  expect(readStoredDocumentState(restored, projectors)).toMatchObject({
    documentKind: VEHICLE_DOCUMENT_KIND,
    fieldValidationIssues: [],
    structuredFields: fields,
    title: "2021 Toyota RAV4",
  });
});

test("titles degrade from year, make, and model to the plate, never the VIN", () => {
  expect(project({ make: "Honda" }).title).toBe("Honda");
  expect(project({ licensePlate: "8ABC123", vin: "JTMW1" }).title).toBe(
    "Vehicle 8ABC123",
  );
  expect(project({ vin: "JTMW1RFV0MD012345" }).title).toBe("Untitled vehicle");
});

test("malformed vehicle fields are flagged and blanks are accepted", () => {
  expect(project({}).fieldValidationIssues).toEqual([]);
  expect(
    project({
      purchaseCurrency: "usd",
      purchaseDate: "2021-13-01",
      purchasePrice: "28,450",
      registrationExpirationDate: "next year",
      vin: "JTM-W1",
      year: "1885",
    }).fieldValidationIssues.map((issue) => issue.field),
  ).toEqual([
    "year",
    "vin",
    "registrationExpirationDate",
    "purchaseDate",
    "purchasePrice",
    "purchaseCurrency",
  ]);
});

test("each service row keeps its own unit and currency, and bad cells are flagged", () => {
  const rows: DocumentRowSummary[] = [
    {
      fields: {
        cost: "89.99",
        currency: "USD",
        odometer: "45120",
        odometerUnit: "mi",
        serviceDate: "2026-03-01",
        work: "Oil change",
      },
      id: "service-1",
    },
    {
      fields: {
        cost: "120,00",
        currency: "EUR",
        odometer: "72 000",
        odometerUnit: "miles",
        serviceDate: "2026-02-30",
        work: "Brakes",
      },
      id: "service-2",
    },
  ];
  expect(project({ make: "Toyota" }, rows).fieldValidationIssues).toEqual([
    {
      field: "rows[1].serviceDate",
      message: "Expected a calendar date in YYYY-MM-DD format.",
      value: "2026-02-30",
    },
    {
      field: "rows[1].odometer",
      message: "Expected a number like 45120.",
      value: "72 000",
    },
    {
      field: "rows[1].odometerUnit",
      message: "Expected one of mi, km.",
      value: "miles",
    },
    {
      field: "rows[1].cost",
      message: "Expected an amount like 1234.56.",
      value: "120,00",
    },
  ]);
});

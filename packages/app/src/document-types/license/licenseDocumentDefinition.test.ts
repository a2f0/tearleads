import { expect, test } from "bun:test";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
  writeStoredDocumentFields,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS as projectors } from "../projectors";
import { getVisibleVariantFields } from "../shared/variantDocumentFieldModel";
import {
  getLicenseFieldLabel,
  LICENSE_DOCUMENT_KIND,
  LICENSE_FIELDS,
  readLicenseFields,
} from "./licenseDocumentDefinition";

async function projectTitle(fields: Record<string, string>): Promise<string> {
  const doc = await createDocument("license-title");
  initializeStoredDocumentKind(doc, LICENSE_DOCUMENT_KIND, projectors);
  writeStoredDocumentFields(doc, LICENSE_DOCUMENT_KIND, fields, projectors);
  return readStoredDocumentState(doc, projectors).title;
}

test("a hunting license snapshot keeps its wildlife details", async () => {
  const doc = await createDocument("license");
  initializeStoredDocumentKind(doc, LICENSE_DOCUMENT_KIND, projectors);
  expect(readStoredDocumentState(doc, projectors).title).toBe(
    "Untitled license",
  );
  const fields = {
    licenseType: "hunting",
    holderName: "Alex Rivera",
    jurisdiction: "Montana",
    issuer: "Fish, Wildlife and Parks",
    licenseNumber: "2026-HNT-448812",
    customerId: "ALS 01234567",
    residency: "resident",
    privileges: "Deer archery, upland bird",
    restrictions: "",
    issueDate: "2026-03-01",
    expirationDate: "2027-02-28",
  };
  writeStoredDocumentFields(doc, LICENSE_DOCUMENT_KIND, fields, projectors);
  const restored = await createDocument("restored-license");
  restored.import(doc.export({ mode: "snapshot" }));
  expect(readStoredDocumentState(restored, projectors)).toMatchObject({
    documentKind: LICENSE_DOCUMENT_KIND,
    fieldValidationIssues: [],
    structuredFields: fields,
    title: "Montana Hunting License",
  });
});

test("titles name where and what, never a whole identifier", async () => {
  expect(
    await projectTitle({ jurisdiction: "Texas", licenseType: "fishing" }),
  ).toBe("Texas Fishing License");
  expect(await projectTitle({ licenseType: "concealed_carry" })).toBe(
    "Concealed Carry Permit",
  );
  expect(await projectTitle({ licenseType: "hunter_education" })).toBe(
    "Hunter Education Certificate",
  );
  expect(
    await projectTitle({ jurisdiction: "Ohio", licenseType: "other" }),
  ).toBe("Ohio License");
  expect(await projectTitle({ jurisdiction: "Ohio" })).toBe("Ohio License");
  // A type written by a newer client still reads as a type.
  expect(
    await projectTitle({
      jurisdiction: "Idaho",
      licenseType: "falconry_permit",
    }),
  ).toBe("Idaho Falconry Permit");
  expect(await projectTitle({ licenseNumber: "FOID 1234 5678" })).toBe(
    "License ending 5678",
  );
  expect(
    await projectTitle({ customerId: "ALS01234567", licenseType: "other" }),
  ).toBe("License ending 4567");
});

test("partial licenses accept blank values and flag malformed stored fields", () => {
  expect(readLicenseFields({}).issues).toEqual([]);
  expect(
    readLicenseFields({
      expirationDate: "next season",
      holderName: 7,
      issueDate: "2026-02-30",
    }).issues.map((issue) => issue.field),
  ).toEqual(["holderName", "issueDate", "expirationDate"]);
});

test("an expiration before the issue date is flagged", () => {
  expect(
    readLicenseFields({
      expirationDate: "2026-02-28",
      issueDate: "2026-03-01",
    }).issues,
  ).toEqual([
    {
      field: "expirationDate",
      message: "Expected an expiration date on or after the issue date.",
      value: "2026-02-28",
    },
  ]);
  expect(
    readLicenseFields({
      expirationDate: "2026-03-01",
      issueDate: "2026-03-01",
    }).issues,
  ).toEqual([]);
});

test("variant fields follow the type but never hide a recorded value", () => {
  const keysFor = (source: Record<string, string>) => {
    const { fields } = readLicenseFields(source);
    return getVisibleVariantFields(
      LICENSE_FIELDS,
      fields.licenseType,
      fields,
    ).map((field) => field.key);
  };

  expect(keysFor({ licenseType: "fishing" })).toEqual(
    expect.arrayContaining(["customerId", "residency", "privileges"]),
  );
  expect(keysFor({ licenseType: "fishing" })).not.toContain("restrictions");
  expect(keysFor({ licenseType: "hunter_education" })).toContain("customerId");
  expect(keysFor({ licenseType: "hunter_education" })).not.toContain(
    "residency",
  );
  expect(keysFor({ licenseType: "concealed_carry" })).toContain("restrictions");
  expect(keysFor({ licenseType: "concealed_carry" })).not.toContain(
    "privileges",
  );
  expect(keysFor({ licenseType: "boating" })).toEqual([
    "holderName",
    "jurisdiction",
    "issuer",
    "licenseNumber",
    "issueDate",
    "expirationDate",
  ]);
  expect(
    keysFor({ licenseType: "firearm", privileges: "Deer archery" }),
  ).toContain("privileges");
});

test("the number's label names the credential the type issues", () => {
  const numberField = LICENSE_FIELDS.find(
    (field) => field.key === "licenseNumber",
  );
  if (numberField === undefined) {
    throw new Error("Expected the license number field.");
  }
  expect(getLicenseFieldLabel(numberField, "hunting")).toBe("License Number");
  expect(getLicenseFieldLabel(numberField, "concealed_carry")).toBe(
    "Permit Number",
  );
  expect(getLicenseFieldLabel(numberField, " hunter_education ")).toBe(
    "Certificate Number",
  );
});

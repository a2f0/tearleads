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
  INSURANCE_POLICY_DOCUMENT_KIND,
  INSURANCE_POLICY_FIELDS,
  readInsurancePolicyFields,
} from "./insurancePolicyDocumentDefinition";

async function projectTitle(fields: Record<string, string>): Promise<string> {
  const doc = await createDocument("insurance-title");
  initializeStoredDocumentKind(doc, INSURANCE_POLICY_DOCUMENT_KIND, projectors);
  writeStoredDocumentFields(
    doc,
    INSURANCE_POLICY_DOCUMENT_KIND,
    fields,
    projectors,
  );
  return readStoredDocumentState(doc, projectors).title;
}

test("a health card snapshot keeps its member and prescription details", async () => {
  const doc = await createDocument("insurance-policy");
  initializeStoredDocumentKind(doc, INSURANCE_POLICY_DOCUMENT_KIND, projectors);
  expect(readStoredDocumentState(doc, projectors).title).toBe(
    "Untitled insurance policy",
  );
  const fields = {
    policyType: "health",
    insurer: "Acme Mutual",
    planName: "Gold PPO",
    policyNumber: "",
    memberId: "XJH123456789",
    groupNumber: "004512",
    rxBin: "610014",
    rxPcn: "MEDDPRIME",
    rxGroup: "RX4512",
    policyholder: "Alex Rivera",
    insured: "Alex Rivera, Sam Rivera",
    effectiveDate: "2026-01-01",
    expirationDate: "2026-12-31",
    agentName: "Member Services",
    agentPhone: "+1 800 555 0100",
  };
  writeStoredDocumentFields(
    doc,
    INSURANCE_POLICY_DOCUMENT_KIND,
    fields,
    projectors,
  );
  const restored = await createDocument("restored-insurance-policy");
  restored.import(doc.export({ mode: "snapshot" }));
  expect(readStoredDocumentState(restored, projectors)).toMatchObject({
    documentKind: INSURANCE_POLICY_DOCUMENT_KIND,
    fieldValidationIssues: [],
    structuredFields: fields,
    title: "Acme Mutual Health Insurance",
  });
});

test("titles name the insurer and type, never a whole identifier", async () => {
  expect(await projectTitle({ insurer: "Acme", policyType: "auto" })).toBe(
    "Acme Auto Insurance",
  );
  expect(await projectTitle({ policyType: "renters" })).toBe(
    "Renters Insurance",
  );
  expect(await projectTitle({ insurer: "Acme", policyType: "other" })).toBe(
    "Acme Insurance",
  );
  // A type written by a newer client still reads as a type.
  expect(await projectTitle({ policyType: "pet_health" })).toBe(
    "Pet Health Insurance",
  );
  expect(await projectTitle({ policyNumber: "HO-99 1234" })).toBe(
    "Insurance Policy ending 1234",
  );
  expect(await projectTitle({ memberId: "XJH123456789" })).toBe(
    "Insurance Policy ending 6789",
  );
});

test("partial policies accept blank values and flag malformed stored fields", () => {
  expect(readInsurancePolicyFields({}).issues).toEqual([]);
  expect(
    readInsurancePolicyFields({
      effectiveDate: "2026-02-30",
      expirationDate: "soon",
      insurer: 7,
      rxBin: "61001",
    }).issues.map((issue) => issue.field),
  ).toEqual(["insurer", "effectiveDate", "expirationDate", "rxBin"]);
});

test("an expiration before the effective date is flagged", () => {
  expect(
    readInsurancePolicyFields({
      effectiveDate: "2026-06-01",
      expirationDate: "2026-05-31",
    }).issues,
  ).toEqual([
    {
      field: "expirationDate",
      message: "Expected an expiration date on or after the effective date.",
      value: "2026-05-31",
    },
  ]);
  expect(
    readInsurancePolicyFields({
      effectiveDate: "2026-06-01",
      expirationDate: "2026-06-01",
    }).issues,
  ).toEqual([]);
});

test("variant fields follow the type but never hide a recorded value", () => {
  const keysFor = (source: Record<string, string>) => {
    const { fields } = readInsurancePolicyFields(source);
    return getVisibleVariantFields(
      INSURANCE_POLICY_FIELDS,
      fields.policyType,
      fields,
    ).map((field) => field.key);
  };

  expect(keysFor({ policyType: "health" })).toContain("rxBin");
  expect(keysFor({ policyType: "dental" })).toContain("memberId");
  expect(keysFor({ policyType: "dental" })).not.toContain("rxBin");
  expect(keysFor({ policyType: "auto" })).not.toContain("memberId");
  expect(keysFor({ policyType: "auto", rxBin: "610014" })).toContain("rxBin");
});

import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@symcrypt/loro";
import {
  createDocumentProjectorRegistry,
  type DocumentFieldValidationIssue,
  deriveStoredDocumentTitle,
  getStoredDocumentTypeLabel,
  getUntitledDocumentTitle,
  initializeStoredDocumentKind,
  projectStoredDocumentState,
  readStoredDocumentState,
  readStringDocumentField,
  writeStoredDocumentFields,
} from "./documentKinds";

test("plain note kind is implicit and does not create Loro ops", async () => {
  const doc = await createDocument("plain-note-kind");
  const versionBeforeRead = encodeVersionVector(doc);

  initializeStoredDocumentKind(doc, "note");

  expect(encodeVersionVector(doc)).toBe(versionBeforeRead);
  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "note",
    text: "",
    title: "Untitled note",
  });
  expect(encodeVersionVector(doc)).toBe(versionBeforeRead);
});

test("JSON-shaped note text does not determine document kind", async () => {
  const jsonShapedText = JSON.stringify({
    carrier: "Acme Mutual",
    kind: "insurance_policy",
    policyId: "POL-123",
    version: 1,
  });
  const doc = await createDocument("json-shaped-note");
  doc.getText("text").update(jsonShapedText);

  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "note",
    structuredFields: {},
    text: jsonShapedText,
    title: jsonShapedText,
  });
  expect(deriveStoredDocumentTitle(jsonShapedText)).toBe(jsonShapedText);
});

test("unknown structured document kinds preserve generic string fields", async () => {
  const doc = await createDocument("custom-structured-document");

  initializeStoredDocumentKind(doc, "insurance_policy");
  writeStoredDocumentFields(doc, "insurance_policy", {
    carrier: "Acme Mutual",
    policyId: "POL-123",
  });

  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "insurance_policy",
    fieldValidationIssues: [],
    structuredFields: {
      carrier: "Acme Mutual",
      policyId: "POL-123",
    },
    title: "Untitled insurance policy",
  });
});

test("unknown structured document kinds preserve validation issues for non-string fields", async () => {
  const doc = await createDocument("custom-structured-numeric-field");

  initializeStoredDocumentKind(doc, "insurance_policy");
  writeStoredDocumentFields(doc, "insurance_policy", {
    annualPremium: 1200,
    policyId: "POL-123",
  });

  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "insurance_policy",
    fieldValidationIssues: [
      {
        field: "annualPremium",
        message: "Expected a string value.",
        value: 1200,
      },
    ],
    structuredFields: {
      annualPremium: "",
      policyId: "POL-123",
    },
  });
});

test("structured field patches can delete fields", async () => {
  const doc = await createDocument("structured-field-delete");

  initializeStoredDocumentKind(doc, "insurance_policy");
  writeStoredDocumentFields(doc, "insurance_policy", {
    carrier: "Acme Mutual",
    policyId: "POL-123",
  });
  writeStoredDocumentFields(doc, "insurance_policy", {
    policyId: undefined,
  });

  expect(readStoredDocumentState(doc)).toMatchObject({
    documentKind: "insurance_policy",
    structuredFields: {
      carrier: "Acme Mutual",
    },
  });
});

test("custom document projector definitions own labels, initialization, and titles", async () => {
  const registry = createDocumentProjectorRegistry([
    {
      initialize(doc) {
        doc.getMap("fields").set("status", "draft");
      },
      kind: "claim",
      label: "benefits claim",
      project({ structuredFields }) {
        const fieldValidationIssues: DocumentFieldValidationIssue[] = [];
        const claimId = readStringDocumentField(
          structuredFields,
          "claimId",
          fieldValidationIssues,
        );
        const status = readStringDocumentField(
          structuredFields,
          "status",
          fieldValidationIssues,
        );

        return {
          fieldValidationIssues,
          structuredFields: {
            claimId,
            status,
          },
          title:
            claimId.length > 0
              ? `Claim ${claimId}`
              : `Untitled claim (${status || "unknown"})`,
        };
      },
      untitledTitle: "Untitled claim",
    },
  ]);
  const doc = await createDocument("custom-projector");

  initializeStoredDocumentKind(doc, "claim", registry);
  writeStoredDocumentFields(doc, "claim", {
    claimId: "CLM-123",
  });

  expect(getStoredDocumentTypeLabel("claim", registry)).toBe("benefits claim");
  expect(getUntitledDocumentTitle("claim", registry)).toBe("Untitled claim");
  expect(readStoredDocumentState(doc, registry)).toMatchObject({
    documentKind: "claim",
    fieldValidationIssues: [],
    structuredFields: {
      claimId: "CLM-123",
      status: "draft",
    },
    title: "Claim CLM-123",
  });
});

test("projecting state can use a supplied registry without a Loro document", () => {
  const registry = createDocumentProjectorRegistry([
    {
      kind: "receipt",
      project({ structuredFields }) {
        const fieldValidationIssues: DocumentFieldValidationIssue[] = [];
        const merchant = readStringDocumentField(
          structuredFields,
          "merchant",
          fieldValidationIssues,
        );

        return {
          fieldValidationIssues,
          structuredFields: { merchant },
          title: merchant || "Untitled receipt",
        };
      },
    },
  ]);

  expect(
    projectStoredDocumentState(
      {
        documentKind: "receipt",
        structuredFields: { merchant: "Central Market" },
        text: "",
      },
      registry,
    ),
  ).toMatchObject({
    documentKind: "receipt",
    structuredFields: { merchant: "Central Market" },
    title: "Central Market",
  });
});

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
import { formatPasscodeExpiry } from "./passcodeAttributes";
import {
  PASSCODE_DOCUMENT_KIND,
  PASSCODE_FIELD_KEYS,
  passcodeDocumentProjectorDefinition,
} from "./passcodeDocumentDefinition";

function project(
  structuredFields: Record<string, string>,
  rows: DocumentRowSummary[] = [],
): DocumentProjection {
  return passcodeDocumentProjectorDefinition.project({
    documentKind: PASSCODE_DOCUMENT_KIND,
    rows,
    structuredFields,
    text: "",
  });
}

test("a passcode snapshot keeps every field exactly as written", async () => {
  const doc = await createDocument("passcode");
  initializeStoredDocumentKind(doc, PASSCODE_DOCUMENT_KIND, projectors);
  expect(readStoredDocumentState(doc, projectors).title).toBe(
    "Untitled passcode",
  );
  // Leading and trailing spaces survive: an imported password is not trimmed.
  const fields = {
    title: " Mail ",
    username: "alice@example.com",
    password: " s3cret-Ω ",
    url: "https://mail.example.com",
    notes: "line one\nline two\n",
    otp: "otpauth://totp/Mail:alice?secret=JBSWY3DPEHPK3PXP",
    tags: "email, work",
    expirationDate: "2027-01-31",
    sourceId: "bWFpbGVudHJ5dXVpZDAwMQ==",
    sourceCreatedAt: "2025-02-01T08:00:00.000Z",
    sourceModifiedAt: "2026-06-01T12:00:00.000Z",
  };
  expect(Object.keys(fields).sort()).toEqual([...PASSCODE_FIELD_KEYS].sort());
  writeStoredDocumentFields(doc, PASSCODE_DOCUMENT_KIND, fields, projectors);
  const restored = await createDocument("restored-passcode");
  restored.import(doc.export({ mode: "snapshot" }));
  expect(readStoredDocumentState(restored, projectors)).toMatchObject({
    documentKind: PASSCODE_DOCUMENT_KIND,
    fieldValidationIssues: [],
    structuredFields: fields,
    title: "Mail",
  });
});

test("titles fall back from the title to the URL's host to the username", () => {
  expect(project({ title: "Bank", url: "https://x.example" }).title).toBe(
    "Bank",
  );
  expect(
    project({ url: "https://login.bank.example/path", username: "me" }).title,
  ).toBe("login.bank.example");
  // A URL that does not parse is used as written.
  expect(project({ url: "bank portal" }).title).toBe("bank portal");
  expect(project({ username: "root" }).title).toBe("root");
  expect(project({ title: "  ", url: " " }).title).toBe("Untitled passcode");
});

test("an expiry must be a calendar date", () => {
  expect(
    project({ expirationDate: "2027-01-31" }).fieldValidationIssues,
  ).toEqual([]);
  expect(
    project({ expirationDate: "31/01/2027" }).fieldValidationIssues.map(
      (issue) => issue.field,
    ),
  ).toEqual(["expirationDate"]);
});

test("an attribute's protected flag is true or blank", () => {
  const rows: DocumentRowSummary[] = [
    { fields: { name: "PIN", protected: "true", value: "4321" }, id: "a" },
    { fields: { name: "Account", protected: "", value: "12-34" }, id: "b" },
    { fields: { name: "Hint", protected: "yes", value: "x" }, id: "c" },
  ];
  expect(project({}, rows).fieldValidationIssues).toEqual([
    {
      field: "rows[2].protected",
      message: 'Expected "true" or blank.',
      value: "yes",
    },
  ]);
});

test("the expiry reads Never, the date, or the date marked expired", () => {
  expect(formatPasscodeExpiry("", "2026-11-25")).toBe("Never");
  expect(formatPasscodeExpiry("2027-01-31", "2026-11-25")).toBe("2027-01-31");
  expect(formatPasscodeExpiry("2026-11-24", "2026-11-25")).toBe(
    "2026-11-24 (expired)",
  );
});

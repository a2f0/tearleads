import { expect, test } from "bun:test";
import { projectStoredDocumentState } from "@tearleads/client-sdk";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "app/continuity";
import {
  checkDocument,
  checkStoredAttachments,
  storedSeedRowsMatch,
} from "./verifySeedContent";

test("verification rejects an edit to a previously empty field", () => {
  const fixture = {
    kind: "contact",
    key: "contact/0",
    attachments: [],
    fields: { firstName: "Alice" },
  };
  const snapshot = {
    ...projectStoredDocumentState(
      { documentKind: "contact", text: "", structuredFields: fixture.fields },
      APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    ),
    seedTag: "original",
    rows: [],
    attachments: [],
  };
  const verify = (
    view: Parameters<typeof checkDocument>[1],
    fields: Record<string, unknown> = fixture.fields,
  ) =>
    checkDocument(fixture, view, fields, "original", [], {
      kind: fixture.kind,
      schemaVersion: 1,
    });
  expect(() => verify(snapshot)).not.toThrow();
  for (const seedTag of [undefined, "another"])
    expect(() => verify({ ...snapshot, seedTag })).toThrow(
      "Fixture content differs",
    );
  expect(() =>
    verify(snapshot, { ...fixture.fields, customField: "extra" }),
  ).toThrow("Fixture content differs");
  expect(() =>
    verify({
      ...snapshot,
      structuredFields: { ...snapshot.structuredFields, nickname: "Ace" },
    }),
  ).toThrow("Fixture content differs");
  const malformed = projectStoredDocumentState(
    {
      documentKind: fixture.kind,
      text: "",
      structuredFields: { ...fixture.fields, nickname: 42 },
    },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  expect(malformed.structuredFields).toEqual(snapshot.structuredFields);
  expect(malformed.fieldValidationIssues).toHaveLength(1);
  expect(() => verify({ ...snapshot, ...malformed })).toThrow(
    "Fixture content differs",
  );
});

test("a malformed extra stored attachment cannot disappear from verification", () => {
  expect(() =>
    checkStoredAttachments("saw", [], { seedTag: "original" }),
  ).not.toThrow();
  expect(() =>
    checkStoredAttachments("saw", [], {
      seedTag: "original",
      "attachment:extra": 17,
    }),
  ).toThrow("Attachment metadata differs: saw");
});

test("a note requires the original empty metadata map", () => {
  const fixture = { kind: "note", key: "note/0", attachments: [] };
  const snapshot = {
    ...projectStoredDocumentState(
      { documentKind: "note", text: "", structuredFields: {} },
      APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    ),
    seedTag: "original",
    rows: [],
    attachments: [],
  };
  const verify = (metadata: Record<string, unknown>) =>
    checkDocument(fixture, snapshot, {}, "original", [], metadata);
  expect(() => verify({})).not.toThrow();
  expect(() => verify({ kind: 42 })).toThrow("Fixture content differs");
});

test("two identical tracker readings remain separately editable", () => {
  const fields = { value: "120" };
  const row = { ...fields, "@id": "first" };
  expect(
    storedSeedRowsMatch([fields, fields], [row, { ...row, "@id": "second" }]),
  ).toBe(true);
  expect(storedSeedRowsMatch([fields, fields], [row, row])).toBe(false);
});

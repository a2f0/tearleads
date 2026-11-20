import { expect, test } from "bun:test";
import { projectStoredDocumentState } from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "app/continuity";
import {
  checkDocument,
  checkSeedRoots,
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
    checkDocument(
      fixture,
      view,
      "original",
      {
        fields,
        metadata: { kind: fixture.kind, schemaVersion: 1 },
        rows: [],
        textDelta: [],
        seedTag: "original",
      },
      "author",
    );
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
  const verify = (
    metadata: Record<string, unknown>,
    text = "",
    seedTag: unknown = "original",
  ) =>
    checkDocument(
      fixture,
      snapshot,
      "original",
      {
        fields: {},
        rows: [],
        metadata,
        textDelta: text ? [{ insert: text }] : [],
        seedTag,
      },
      "author",
    );
  expect(() => verify({}, "stale checkpoint")).toThrow(
    "Fixture content differs",
  );
  expect(() => verify({}, "", null)).toThrow("Fixture content differs");
  expect(() => verify({})).not.toThrow();
  expect(() => verify({ kind: 42 })).toThrow("Fixture content differs");
});

test("a formatting-only edit changes the stored note", async () => {
  const doc = await createDocument("formatted-note");
  try {
    doc.configTextStyle({ bold: { expand: "after" } });
    const text = doc.getText("text");
    text.insert(0, "Hello");
    const fixture = {
      kind: "note",
      key: "note/0",
      text: "Hello",
      attachments: [],
    };
    const snapshot = {
      ...projectStoredDocumentState(
        { documentKind: "note", text: "Hello", structuredFields: {} },
        APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      ),
      seedTag: "original",
      rows: [],
      attachments: [],
    };
    const verify = () =>
      checkDocument(
        fixture,
        snapshot,
        "original",
        {
          fields: {},
          rows: [],
          metadata: {},
          textDelta: text.toDelta(),
          seedTag: "original",
        },
        "author",
      );
    expect(verify).not.toThrow();
    text.mark({ start: 0, end: 5 }, "bold", true);
    expect(verify).toThrow("Fixture content differs");
  } finally {
    doc.free();
  }
});

test("two identical tracker readings remain separately editable", () => {
  const fields = { value: "120" };
  const row = {
    ...fields,
    "@id": "first",
    "@createdAt": "2026-01-01T00:00:00.000Z",
    "@createdBy": "author",
    "@updatedAt": "2026-01-01T00:00:00.000Z",
    "@updatedBy": "author",
  };
  expect(
    storedSeedRowsMatch(
      [fields, fields],
      [row, { ...row, "@id": "second" }],
      "author",
    ),
  ).toBe(true);
  expect(storedSeedRowsMatch([fields, fields], [row, row], "author")).toBe(
    false,
  );
  const projected = {
    id: row["@id"],
    createdBy: "author",
    updatedBy: "author",
    createdAt: row["@createdAt"],
    updatedAt: row["@updatedAt"],
    updatedByPeer: null,
    createdByPeer: null,
    fieldEditors: {},
    fields,
  };
  expect(storedSeedRowsMatch([fields], [row], "author", [projected])).toBe(
    true,
  );
  expect(
    storedSeedRowsMatch([fields], [row], "author", [
      { ...projected, createdBy: "" },
    ]),
  ).toBe(false);
  for (const edit of [
    { "@createdBy": undefined },
    { "@updatedBy": "other" },
    { "@createdAt": "invalid", "@updatedAt": "invalid" },
    { "@updatedAt": "2026-01-02T00:00:00.000Z" },
  ])
    expect(storedSeedRowsMatch([fields], [{ ...row, ...edit }], "author")).toBe(
      false,
    );
});

test("an unexpected populated Loro root cannot pass fixture verification", async () => {
  const doc = await createDocument("fixture-roots");
  try {
    doc.getText("text").update("Hello");
    expect(() => checkSeedRoots("note", doc.getShallowValue())).not.toThrow();
    doc.getMap("other").set("hidden", true);
    expect(() => checkSeedRoots("note", doc.getShallowValue())).toThrow(
      "Unexpected document root",
    );
  } finally {
    doc.free();
  }
});

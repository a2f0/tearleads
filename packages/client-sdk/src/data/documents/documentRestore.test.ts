import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import {
  addDocumentAttachments,
  getDocumentAttachments,
} from "./documentContent";
import {
  readStoredDocumentState,
  writeStoredDocumentFields,
} from "./documentKinds";
import {
  type DocumentRestoreContent,
  restoreDocumentContent,
} from "./documentRestore";
import { addDocumentRow, listDocumentRows } from "./documentRowList";

const BEFORE = { at: "2030-01-01T00:00:00.000Z", userId: "author" };
const RESTORER = { at: "2030-06-01T00:00:00.000Z", userId: "restorer" };

type Doc = Awaited<ReturnType<typeof createDocument>>;

function content(overrides: Partial<DocumentRestoreContent>) {
  return { rows: [], structuredFields: {}, text: "", ...overrides };
}

function rowsOf(doc: Doc) {
  return listDocumentRows(doc).map((row) => ({
    fields: row.fields,
    id: row.id,
  }));
}

async function contactWithRows(
  rows: ReadonlyArray<{ fields: Record<string, string>; id: string }>,
): Promise<Doc> {
  const doc = await createDocument(`restore-${crypto.randomUUID()}`);
  writeStoredDocumentFields(doc, "contact", { firstName: "Ada" });
  for (const row of rows) addDocumentRow(doc, row.id, row.fields, BEFORE);
  doc.commit();
  return doc;
}

test("text is replaced with the restored text", async () => {
  const doc = await createDocument("restore-text");
  doc.getText("text").update("the current text");

  expect(
    restoreDocumentContent(doc, content({ text: "the old text" }), RESTORER),
  ).toBe(true);
  expect(doc.getText("text").toString()).toBe("the old text");
});

test("content that already matches changes nothing", async () => {
  const doc = await contactWithRows([
    { id: "r1", fields: { street: "1 Way" } },
  ]);
  const before = doc.oplogVersion().toJSON();
  const same = content({
    rows: [{ id: "r1", fields: { street: "1 Way" } }],
    structuredFields: { firstName: "Ada" },
  });

  expect(restoreDocumentContent(doc, same, RESTORER)).toBe(false);
  doc.commit();
  expect(doc.oplogVersion().toJSON()).toEqual(before);
});

test("structured fields are set, changed, and cleared", async () => {
  const doc = await createDocument("restore-fields");
  writeStoredDocumentFields(doc, "contact", {
    firstName: "Ada",
    lastName: "Lovelace",
    nickname: "Countess",
  });

  expect(
    restoreDocumentContent(
      doc,
      content({ structuredFields: { firstName: "Augusta", title: "Hon." } }),
      RESTORER,
    ),
  ).toBe(true);
  expect(readStoredDocumentState(doc).structuredFields).toEqual({
    firstName: "Augusta",
    title: "Hon.",
  });
  expect(readStoredDocumentState(doc).documentKind).toBe("contact");
});

test("a note's structured fields are left alone", async () => {
  const doc = await createDocument("restore-note");
  doc.getText("text").update("note");

  expect(
    restoreDocumentContent(
      doc,
      content({ structuredFields: { firstName: "Ada" }, text: "note" }),
      RESTORER,
    ),
  ).toBe(false);
  expect(readStoredDocumentState(doc).documentKind).toBe("note");
});

test("leading rows are patched in place, cell by cell", async () => {
  const doc = await contactWithRows([
    { id: "r1", fields: { street: "1 Way", city: "Paris" } },
    { id: "r2", fields: { street: "2 Way" } },
  ]);
  const [original] = listDocumentRows(doc);
  if (!original) throw new Error("expected a row");
  const { city: cityEditorBefore } = original.fieldEditors;

  restoreDocumentContent(
    doc,
    content({
      rows: [
        { id: "r1", fields: { street: "1 Road", city: "Paris" } },
        { id: "r2", fields: { street: "2 Way", region: "Lazio" } },
      ],
      structuredFields: { firstName: "Ada" },
    }),
    RESTORER,
  );

  expect(rowsOf(doc)).toEqual([
    { id: "r1", fields: { street: "1 Road", city: "Paris" } },
    { id: "r2", fields: { street: "2 Way", region: "Lazio" } },
  ]);
  const [first] = listDocumentRows(doc);
  // The row was patched, not rebuilt: it keeps its creation and the
  // untouched cell keeps its last editor.
  if (!first) throw new Error("expected a row");
  const { city: cityEditorAfter } = first.fieldEditors;
  expect(first.createdAt).toBe(original.createdAt);
  expect(cityEditorAfter).toBe(cityEditorBefore);
  expect(first.updatedBy).toBe("restorer");
});

test("rows after the first difference are rebuilt in the restored order", async () => {
  const doc = await contactWithRows([
    { id: "kept", fields: { street: "1 Way" } },
    { id: "extra", fields: { street: "9 Way" } },
    { id: "later", fields: { street: "3 Way" } },
  ]);

  restoreDocumentContent(
    doc,
    content({
      rows: [
        { id: "kept", fields: { street: "1 Way" } },
        { id: "gone", fields: { street: "2 Way" } },
        { id: "later", fields: { street: "3 Way" } },
      ],
      structuredFields: { firstName: "Ada" },
    }),
    RESTORER,
  );

  expect(rowsOf(doc)).toEqual([
    { id: "kept", fields: { street: "1 Way" } },
    { id: "gone", fields: { street: "2 Way" } },
    { id: "later", fields: { street: "3 Way" } },
  ]);
});

test("a row that needs a cell cleared is rebuilt under its own id", async () => {
  const doc = await contactWithRows([
    { id: "r1", fields: { street: "1 Way", city: "Paris" } },
  ]);

  restoreDocumentContent(
    doc,
    content({
      rows: [{ id: "r1", fields: { street: "1 Way" } }],
      structuredFields: { firstName: "Ada" },
    }),
    RESTORER,
  );

  expect(rowsOf(doc)).toEqual([{ id: "r1", fields: { street: "1 Way" } }]);
});

test("every row is removed when the restored version had none", async () => {
  const doc = await contactWithRows([
    { id: "r1", fields: { street: "1 Way" } },
    { id: "r2", fields: { street: "2 Way" } },
  ]);

  restoreDocumentContent(
    doc,
    content({ structuredFields: { firstName: "Ada" } }),
    RESTORER,
  );

  expect(rowsOf(doc)).toEqual([]);
});

test("attachments are never touched by a restore", async () => {
  const doc = await createDocument("restore-attachments");
  doc.getText("text").update("with a file");
  addDocumentAttachments(doc, [
    {
      byteLength: 3,
      contentSha256: "aa",
      mimeType: "text/plain",
      name: "file.txt",
      slotId: "slot-1",
    },
  ]);
  const before = getDocumentAttachments(doc);

  restoreDocumentContent(doc, content({ text: "before the file" }), RESTORER);

  expect(getDocumentAttachments(doc)).toEqual(before);
  expect(doc.getText("text").toString()).toBe("before the file");
});

test("a restore adds operations and keeps every earlier one", async () => {
  const doc = await createDocument("restore-history");
  doc.getText("text").update("first");
  doc.commit();
  const first = doc.oplogFrontiers();
  doc.getText("text").update("first and second");
  doc.commit();
  const before = doc.oplogVersion().toJSON();

  restoreDocumentContent(doc, content({ text: "first" }), RESTORER);
  doc.commit();

  for (const [peer, counter] of before) {
    expect(doc.oplogVersion().get(peer)).toBeGreaterThan(counter);
  }
  // The versions before the restore are still there to go back to.
  const reader = doc.fork();
  reader.checkout(first);
  expect(reader.getText("text").toString()).toBe("first");
});

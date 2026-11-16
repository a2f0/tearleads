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

test("a row the document no longer has comes back as a new row at the end", async () => {
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

  const rows = rowsOf(doc);
  expect(rows.map((row) => row.fields)).toEqual([
    { street: "1 Way" },
    { street: "3 Way" },
    { street: "2 Way" },
  ]);
  // Surviving rows keep their ids; the returning row gets one of its own.
  expect(rows.slice(0, 2).map((row) => row.id)).toEqual(["kept", "later"]);
  expect(["kept", "extra", "gone", "later"]).not.toContain(rows[2]?.id);
});

test("a cell the restored row did not have is cleared in place", async () => {
  const doc = await contactWithRows([
    { id: "r1", fields: { street: "1 Way", city: "Paris" } },
  ]);
  const [original] = listDocumentRows(doc);

  restoreDocumentContent(
    doc,
    content({
      rows: [{ id: "r1", fields: { street: "1 Way" } }],
      structuredFields: { firstName: "Ada" },
    }),
    RESTORER,
  );

  const [restored] = listDocumentRows(doc);
  expect(rowsOf(doc)).toEqual([{ id: "r1", fields: { street: "1 Way" } }]);
  // The same row, edited: not a replacement.
  expect(restored?.createdAt).toBe(original?.createdAt);
  expect(restored?.updatedBy).toBe("restorer");
});

test("a cell named like an inherited property is still cleared", async () => {
  const doc = await contactWithRows([
    { id: "r1", fields: { constructor: "x", street: "1 Way", toString: "y" } },
  ]);

  expect(
    restoreDocumentContent(
      doc,
      content({
        rows: [{ id: "r1", fields: { street: "1 Way" } }],
        structuredFields: { firstName: "Ada" },
      }),
      RESTORER,
    ),
  ).toBe(true);

  expect(rowsOf(doc)).toEqual([{ id: "r1", fields: { street: "1 Way" } }]);
});

test("two devices restoring the same version never share a row id", async () => {
  const alice = await contactWithRows([
    { id: "r1", fields: { street: "1 Way" } },
  ]);
  const target = content({
    rows: [{ id: "r1", fields: { street: "1 Way" } }],
    structuredFields: { firstName: "Ada" },
  });
  // The row is deleted, and that state reaches a second device.
  restoreDocumentContent(
    alice,
    content({ structuredFields: { firstName: "Ada" } }),
    BEFORE,
  );
  alice.commit();
  const bob = await createDocument(`restore-peer-${crypto.randomUUID()}`);
  bob.import(alice.export({ mode: "update" }));

  // Both restore the version that had the row, before either syncs.
  restoreDocumentContent(alice, target, RESTORER);
  restoreDocumentContent(bob, target, RESTORER);
  alice.commit();
  bob.commit();
  alice.import(bob.export({ mode: "update" }));
  bob.import(alice.export({ mode: "update" }));

  const ids = rowsOf(alice).map((row) => row.id);
  expect(
    rowsOf(bob)
      .map((row) => row.id)
      .sort(),
  ).toEqual([...ids].sort());
  // Each restore added its own copy; every row can still be addressed.
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(rowsOf(alice).map((row) => row.fields)).toEqual([
    { street: "1 Way" },
    { street: "1 Way" },
  ]);
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

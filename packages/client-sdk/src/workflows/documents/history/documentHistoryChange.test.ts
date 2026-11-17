import { expect, test } from "bun:test";
import type { DocumentAttachment } from "../../../data/documents/documentContent";
import type { DocumentRow } from "../../../data/documents/documentRowList";
import {
  compareDocumentHistoryContent,
  type DocumentHistoryContent,
  isEmptyDocumentHistoryChange,
} from "./documentHistoryChange";

function content(
  overrides: Partial<DocumentHistoryContent> = {},
): DocumentHistoryContent {
  return {
    attachments: [],
    documentKind: "note",
    rows: [],
    structuredFields: {},
    text: "",
    ...overrides,
  };
}

function row(id: string, fields: Record<string, string>): DocumentRow {
  return {
    id,
    fields,
    fieldEditors: {},
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
  };
}

function attachment(
  slotId: string,
  overrides: Partial<DocumentAttachment> = {},
): DocumentAttachment {
  return {
    byteLength: 3,
    contentSha256: "aa",
    mimeType: "text/plain",
    name: "file.txt",
    slotId,
    ...overrides,
  };
}

function textChange(before: string, after: string) {
  return compareDocumentHistoryContent(
    content({ text: before }),
    content({ text: after }),
  ).text;
}

test("identical versions report no change", () => {
  const same = content({
    attachments: [attachment("slot")],
    rows: [row("r1", { street: "1 Way" })],
    structuredFields: { firstName: "Ada" },
    text: "hello",
  });
  const change = compareDocumentHistoryContent(same, { ...same });

  expect(change.text).toBeNull();
  expect(isEmptyDocumentHistoryChange(change)).toBe(true);
});

test("a text edit is the one region that differs", () => {
  expect(textChange("hello world", "hello brave world")).toEqual({
    start: 6,
    insertedLength: 6,
    removedLength: 0,
  });
  expect(textChange("hello brave world", "hello world")).toEqual({
    start: 6,
    insertedLength: 0,
    removedLength: 6,
  });
  expect(textChange("hello world", "hello there")).toEqual({
    start: 6,
    insertedLength: 5,
    removedLength: 5,
  });
  // Repeated characters: the region is as small as either end allows.
  expect(textChange("aaa", "aaaa")).toEqual({
    start: 3,
    insertedLength: 1,
    removedLength: 0,
  });
});

test("edits in two places are one spanning region", () => {
  expect(textChange("one two three", "ONE two THREE")).toEqual({
    start: 0,
    insertedLength: 13,
    removedLength: 13,
  });
});

test("a text region never splits a surrogate pair", () => {
  // The two emoji share their high surrogate and differ in the low one.
  expect(textChange("a\u{1F600}b", "a\u{1F601}b")).toEqual({
    start: 1,
    insertedLength: 2,
    removedLength: 2,
  });
  // These share their low surrogate and differ in the high one.
  expect(textChange("a\u{1F600}b", "a\u{1FA00}b")).toEqual({
    start: 1,
    insertedLength: 2,
    removedLength: 2,
  });
});

test("structured fields report set, changed, and cleared keys in order", () => {
  const change = compareDocumentHistoryContent(
    content({ structuredFields: { a: "1", b: "2", c: "3" } }),
    content({ structuredFields: { a: "1", b: "20", d: "4" } }),
  );

  expect(change.fields).toEqual(["b", "c", "d"]);
  expect(isEmptyDocumentHistoryChange(change)).toBe(false);
});

test("rows report additions, removals, and the cells that changed", () => {
  const change = compareDocumentHistoryContent(
    content({
      rows: [
        row("kept", { street: "1 Way", city: "Paris" }),
        row("edited", { street: "2 Way", city: "Rome" }),
        row("removed", { street: "3 Way" }),
      ],
    }),
    content({
      rows: [
        row("kept", { street: "1 Way", city: "Paris" }),
        row("edited", { street: "2 Road", region: "Lazio" }),
        row("added", { street: "4 Way" }),
      ],
    }),
  );

  expect(change.rows).toEqual({
    added: ["added"],
    changed: [{ id: "edited", fields: ["city", "region", "street"] }],
    removed: ["removed"],
  });
});

test("attachments report added, removed, and replaced slots", () => {
  const change = compareDocumentHistoryContent(
    content({
      attachments: [
        attachment("kept"),
        attachment("swapped"),
        attachment("renamed"),
        attachment("gone"),
      ],
    }),
    content({
      attachments: [
        attachment("kept"),
        attachment("swapped", { contentSha256: "bb" }),
        attachment("renamed", { name: "other.txt" }),
        attachment("new"),
      ],
    }),
  );

  expect(change.attachments).toEqual({
    added: ["new"],
    removed: ["gone"],
    replaced: ["swapped", "renamed"],
  });
});

test("a kind change is reported on its own", () => {
  const change = compareDocumentHistoryContent(
    content({ documentKind: "note" }),
    content({ documentKind: "contact" }),
  );

  expect(change.kindChanged).toBe(true);
  expect(isEmptyDocumentHistoryChange(change)).toBe(false);
});

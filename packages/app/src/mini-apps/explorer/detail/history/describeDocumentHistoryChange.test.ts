import { expect, test } from "bun:test";
import type { DocumentHistoryChange } from "@tearleads/client-sdk";
import { describeDocumentHistoryChange } from "./describeDocumentHistoryChange";

function change(
  overrides: Partial<DocumentHistoryChange>,
): DocumentHistoryChange {
  return {
    attachments: { added: [], removed: [], replaced: [] },
    fields: [],
    kindChanged: false,
    rows: { added: [], changed: [], removed: [] },
    text: null,
    ...overrides,
  };
}

test("a step with no visible effect says so", () => {
  expect(describeDocumentHistoryChange(change({}))).toEqual([
    "No visible change",
  ]);
});

test("text edits are described by how many characters changed", () => {
  expect(
    describeDocumentHistoryChange(
      change({ text: { insertedLength: 12, removedLength: 0, start: 0 } }),
    ),
  ).toEqual(["Added 12 characters"]);
  expect(
    describeDocumentHistoryChange(
      change({ text: { insertedLength: 0, removedLength: 1, start: 4 } }),
    ),
  ).toEqual(["Removed 1 character"]);
  expect(
    describeDocumentHistoryChange(
      change({ text: { insertedLength: 5, removedLength: 3, start: 4 } }),
    ),
  ).toEqual(["Replaced 3 characters with 5"]);
});

test("field keys read as words", () => {
  expect(
    describeDocumentHistoryChange(
      change({ fields: ["firstName", "postal_code", "nickname"] }),
    ),
  ).toEqual(["Changed first name, postal code, nickname"]);
});

test("row changes name the cells that were edited once each", () => {
  expect(
    describeDocumentHistoryChange(
      change({
        rows: {
          added: ["a"],
          changed: [
            { id: "b", fields: ["street", "postalCode"] },
            { id: "c", fields: ["street"] },
          ],
          removed: ["d", "e"],
        },
      }),
    ),
  ).toEqual([
    "Added a row",
    "Edited rows (street, postal code)",
    "Removed rows",
  ]);
});

test("attachment changes are counted by kind", () => {
  expect(
    describeDocumentHistoryChange(
      change({
        attachments: { added: ["a", "b"], removed: ["c"], replaced: ["d"] },
      }),
    ),
  ).toEqual([
    "Added attachments",
    "Replaced an attachment",
    "Removed an attachment",
  ]);
});

test("a step that changed several things lists each in reading order", () => {
  expect(
    describeDocumentHistoryChange(
      change({
        fields: ["firstName"],
        kindChanged: true,
        text: { insertedLength: 2, removedLength: 0, start: 0 },
      }),
    ),
  ).toEqual([
    "Changed the document type",
    "Added 2 characters",
    "Changed first name",
  ]);
});

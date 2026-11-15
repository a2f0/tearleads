import { expect, test } from "bun:test";
import type { DocumentRow } from "@tearleads/client-sdk";
import {
  contactFieldsToEntry,
  readContactFields,
} from "../../document-types/contact/contactDocumentModel";
import { sameContactEntry } from "./contactSnapshot";

const row: DocumentRow = {
  id: "address",
  fields: { recordType: "postalAddress", postalCode: "00123" },
  createdBy: "author",
  createdAt: "time",
  updatedBy: "author",
  updatedAt: "time",
  createdByPeer: "1",
  updatedByPeer: "2",
  fieldEditors: { postalCode: "3" },
};
const entry = contactFieldsToEntry("contact", readContactFields({}));

test("contact projection keeps hydration and remote identity distinct", () => {
  const hydrated = contactFieldsToEntry("contact", readContactFields({}), {
    rows: [row],
    documentId: "remote",
    syncing: true,
  });
  expect(entry.rows).toBeUndefined();
  expect(hydrated.rows).toEqual([row]);
  expect(hydrated.documentId).toBe("remote");
  expect(hydrated.syncing).toBe(true);
});

test("snapshot equality observes hydration, sync identity and every row field", () => {
  expect(sameContactEntry(entry, { ...entry, rows: [] })).toBe(false);
  expect(sameContactEntry(entry, { ...entry, documentId: "remote" })).toBe(
    false,
  );
  expect(sameContactEntry(entry, { ...entry, syncing: true })).toBe(false);
  const hydrated = { ...entry, rows: [row] };
  expect(
    sameContactEntry(hydrated, {
      ...entry,
      rows: [
        {
          ...row,
          fields: { ...row.fields },
          fieldEditors: { ...row.fieldEditors },
        },
      ],
    }),
  ).toBe(true);
  for (const patch of [
    { id: "other" },
    { fields: { ...row.fields, postalCode: "00124" } },
    { createdBy: "other" },
    { createdAt: "later" },
    { updatedBy: "other" },
    { updatedAt: "later" },
    { createdByPeer: "4" },
    { updatedByPeer: "4" },
    { fieldEditors: { postalCode: "4" } },
  ]) {
    expect(
      sameContactEntry(hydrated, { ...entry, rows: [{ ...row, ...patch }] }),
    ).toBe(false);
  }
});

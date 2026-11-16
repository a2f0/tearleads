import { expect, test } from "bun:test";
import type {
  DocumentHistoryView,
  DocumentSnapshot,
} from "@tearleads/client-sdk";
import {
  createHistoricalDocumentStore,
  historicalDocumentSnapshot,
} from "./historicalDocumentStore";

function attachment(slotId: string, contentSha256: string) {
  return {
    byteLength: 3,
    contentSha256,
    mimeType: "text/plain",
    name: `${slotId}.txt`,
    slotId,
  };
}

const LIVE: DocumentSnapshot = {
  attachments: [attachment("kept", "aa"), attachment("swapped", "new")],
  attachmentStatusBySlotId: { kept: "syncing" },
  attachmentStorageKeyBySlotId: { kept: "key-kept", swapped: "key-swapped" },
  canAttach: true,
  canWrite: true,
  currentAuthorId: "user-1",
  documentId: "remote-1",
  documentKind: "note",
  effectiveAccessLevel: "admin",
  fieldValidationIssues: [],
  ready: true,
  rows: [],
  structuredFields: {},
  syncing: true,
  text: "live text",
  title: "live text",
};

const PAST: DocumentHistoryView = {
  attachments: [
    attachment("kept", "aa"),
    attachment("swapped", "old"),
    attachment("gone", "bb"),
  ],
  documentKind: "contact",
  fieldValidationIssues: [],
  rows: [],
  structuredFields: { firstName: "Ada" },
  text: "past text",
  title: "Ada",
};

test("a past version shows its own content and never accepts writes", () => {
  const snapshot = historicalDocumentSnapshot(LIVE, PAST);

  expect(snapshot).toMatchObject({
    canAttach: false,
    canWrite: false,
    documentKind: "contact",
    ready: true,
    structuredFields: { firstName: "Ada" },
    syncing: false,
    text: "past text",
    title: "Ada",
  });
  expect(snapshot.attachmentStatusBySlotId).toEqual({});
});

test("a past version keeps the live document's identity and access", () => {
  expect(historicalDocumentSnapshot(LIVE, PAST)).toMatchObject({
    currentAuthorId: "user-1",
    documentId: "remote-1",
    effectiveAccessLevel: "admin",
  });
});

test("a past attachment resolves bytes only while the live slot still holds them", () => {
  const snapshot = historicalDocumentSnapshot(LIVE, PAST);

  expect(snapshot.attachments.map((item) => item.slotId)).toEqual([
    "kept",
    "swapped",
    "gone",
  ]);
  // "swapped" now holds different bytes and "gone" was detached.
  expect(snapshot.attachmentStorageKeyBySlotId).toEqual({ kept: "key-kept" });
});

test("a slot whose held bytes differ from the document never lends them to a past version", () => {
  // The live document records digest "aa" for the slot, as the past version
  // does, but the bytes this device holds for it are a different upload.
  const snapshot = historicalDocumentSnapshot(
    { ...LIVE, attachmentStatusBySlotId: { kept: "intent-mismatch" } },
    PAST,
  );

  expect(snapshot.attachmentStorageKeyBySlotId).toEqual({});
});

test("a slot still uploading its own bytes lends them to a past version", () => {
  const snapshot = historicalDocumentSnapshot(
    { ...LIVE, attachmentStatusBySlotId: { kept: "syncing" } },
    PAST,
  );

  expect(snapshot.attachmentStorageKeyBySlotId).toEqual({ kept: "key-kept" });
});

test("the store notifies subscribers when the version on screen changes", () => {
  const first = historicalDocumentSnapshot(LIVE, PAST);
  const second = historicalDocumentSnapshot(LIVE, { ...PAST, text: "later" });
  const historical = createHistoricalDocumentStore(first);
  let notifications = 0;
  const unsubscribe = historical.store.subscribe(() => {
    notifications += 1;
  });

  expect(historical.store.getSnapshot()).toBe(first);
  historical.show(second);
  expect(historical.store.getSnapshot()).toBe(second);
  expect(notifications).toBe(1);

  // Showing the same version again is not a change.
  historical.show(second);
  expect(notifications).toBe(1);

  unsubscribe();
  historical.show(first);
  expect(notifications).toBe(1);
});

test("mutations on a past version change nothing", async () => {
  const snapshot = historicalDocumentSnapshot(LIVE, PAST);
  const { store } = createHistoricalDocumentStore(snapshot);

  await store.setText("rewritten");
  await store.setStructuredFields("contact", { firstName: "Eve" });
  await store.addRow({ street: "1 Way" });
  await store.updateRowFields("row", { street: "2 Way" });
  await store.removeRow("row");
  store.removeAttachment("kept");
  store.attachFiles([]);

  expect(store.getSnapshot()).toBe(snapshot);
  expect(store.hasQueuedWrites()).toBe(false);
  expect(store.hasUnsavedLocalEdits()).toBe(false);
  expect(await store.discardLocalState("remote-1")).toBe(false);
  expect(store.assertCanRotateContentKey("prove")).rejects.toThrow();
});

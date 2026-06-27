import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import {
  createDocumentStorePersistence,
  createDocumentStoreRuntime,
} from "../../../../test/helpers/documentStoreFixtures";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("document store seeds initial note text before first persistence", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const initialText = "Seeded note";
  const store = createDocumentStore(
    "seeded-note",
    runtime,
    persistence,
    null,
    initialText,
  );

  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document store did not become ready.",
  );

  expect(store.getSnapshot()).toEqual({
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    canWrite: true,
    documentId: null,
    documentKind: "note",
    effectiveAccessLevel: "admin",
    fieldValidationIssues: [],
    ready: true,
    structuredFields: {},
    syncing: false,
    text: initialText,
    title: "Seeded note",
  });
  expect(persistence.getState().document?.text).toBe(initialText);
  expect(persistence.getState().pendingUpdates).toHaveLength(1);
});

test("document store seeds initial structured document kind before first persistence", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    "initial-card",
    runtime,
    persistence,
    null,
    "",
    "credit_card",
  );

  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Structured document store did not become ready.",
  );

  expect(store.getSnapshot()).toMatchObject({
    documentKind: "credit_card",
    fieldValidationIssues: [],
    ready: true,
    structuredFields: {
      cardNumber: "",
      cvvCode: "",
      expirationDate: "",
      nameOnCard: "",
    },
    text: "",
    title: "Untitled credit card",
  });
  expect(persistence.getState().document).toMatchObject({
    documentKind: "credit_card",
    text: "",
    title: "Untitled credit card",
  });
  expect(persistence.getState().pendingUpdates).toHaveLength(1);
});

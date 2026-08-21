import { expect, test } from "bun:test";
import { createDocumentStore } from "@symcrypt/client-sdk";
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
    currentAuthorId: null,
    documentId: null,
    documentKind: "note",
    effectiveAccessLevel: "admin",
    fieldValidationIssues: [],
    ready: true,
    rows: [],
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
      issuer: "",
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

test("document store seeds initial passport fields before first persistence", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    "initial-passport",
    runtime,
    persistence,
    null,
    "",
    "passport",
  );

  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Passport document store did not become ready.",
  );

  expect(store.getSnapshot()).toMatchObject({
    documentKind: "passport",
    fieldValidationIssues: [],
    ready: true,
    structuredFields: {
      expirationDate: "",
      fullName: "",
      issuingCountry: "",
      passportNumber: "",
    },
    text: "",
    title: "Untitled passport",
  });
  expect(persistence.getState().document).toMatchObject({
    documentKind: "passport",
    text: "",
    title: "Untitled passport",
  });
  expect(persistence.getState().pendingUpdates).toHaveLength(1);
});

test("document store seeds initial env file fields before first persistence", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    "initial-env-file",
    runtime,
    persistence,
    null,
    "",
    "env_file",
  );

  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Env file document store did not become ready.",
  );

  expect(store.getSnapshot()).toMatchObject({
    documentKind: "env_file",
    fieldValidationIssues: [],
    ready: true,
    rows: [],
    structuredFields: {
      fileName: "",
    },
    text: "",
    title: "Untitled .env file",
  });
  expect(persistence.getState().document).toMatchObject({
    documentKind: "env_file",
    text: "",
    title: "Untitled .env file",
  });
  expect(persistence.getState().pendingUpdates).toHaveLength(1);
});

import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import {
  createDocumentStorePersistence,
  createDocumentStoreRuntime,
} from "../../../../test/helpers/documentStoreFixtures";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] | null = null;
  let reject: Deferred<T>["reject"] | null = null;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  if (!resolve || !reject) {
    throw new Error("Failed to create deferred.");
  }

  return { promise, reject, resolve };
}

test("document store publishes text edits synchronously for controlled editors", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore("sync-note", runtime, persistence);

  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document store did not become ready.",
  );

  const write = store.setText("typed draft");

  expect(store.getSnapshot().text).toBe("typed draft");

  await write;
  expect(persistence.getState().document?.text).toBe("typed draft");
});

test("document store does not replay intermediate persisted text during queued edits", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore("queued-note", runtime, persistence);

  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document store did not become ready.",
  );

  const originalSaveDocument = persistence.saveDocument;
  const releaseFirstEditSave = createDeferred();
  const releaseSecondEditSave = createDeferred();
  let editSaveCount = 0;

  persistence.saveDocument = async (...args) => {
    editSaveCount += 1;
    if (editSaveCount === 1) {
      await releaseFirstEditSave.promise;
    } else if (editSaveCount === 2) {
      await releaseSecondEditSave.promise;
    }

    return originalSaveDocument(...args);
  };

  const firstWrite = store.setText("a");
  const secondWrite = store.setText("ab");

  expect(store.getSnapshot().text).toBe("ab");

  releaseFirstEditSave.resolve();
  await waitForCondition(
    () => editSaveCount === 2,
    "Second queued text save did not start.",
  );

  expect(store.getSnapshot().text).toBe("ab");

  releaseSecondEditSave.resolve();
  await Promise.all([firstWrite, secondWrite]);

  expect(store.getSnapshot().text).toBe("ab");
  expect(persistence.getState().document?.text).toBe("ab");
});

test("a reset write cannot publish over replacement-generation text", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore("reset-write-note", runtime, persistence);

  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document store did not become ready.",
  );

  const originalSaveDocument = persistence.saveDocument;
  const oldSaveStarted = createDeferred();
  const releaseOldSave = createDeferred();
  const replacementSaveStarted = createDeferred();
  const releaseReplacementSave = createDeferred();
  let editSaveCount = 0;
  persistence.saveDocument = async (...args) => {
    editSaveCount += 1;
    if (editSaveCount === 1) {
      oldSaveStarted.resolve();
      await releaseOldSave.promise;
    } else if (editSaveCount === 2) {
      replacementSaveStarted.resolve();
      await releaseReplacementSave.promise;
    }
    return originalSaveDocument(...args);
  };

  const oldWrite = store.setText("old generation");
  await oldSaveStarted.promise;

  store.updateRuntime({
    ...runtime,
    infra: { ...runtime.infra, dbStatus: "terminated" },
  });
  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document store did not reinitialize.",
  );

  const replacementWrite = store.setText("replacement generation");
  expect(store.getSnapshot().text).toBe("replacement generation");

  releaseOldSave.resolve();
  await replacementSaveStarted.promise;

  expect(store.getSnapshot().text).toBe("replacement generation");
  expect(persistence.getState().document?.text).toBe("old generation");

  releaseReplacementSave.resolve();
  await Promise.all([oldWrite, replacementWrite]);

  expect(store.getSnapshot().text).toBe("replacement generation");
  expect(persistence.getState().document?.text).toBe("replacement generation");
});

test("document store publishes structured field edits synchronously for controlled editors", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    "sync-structured-card",
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

  const write = store.setStructuredFields("credit_card", {
    cardNumber: "4111 1111 1111 5678",
  });

  expect(store.getSnapshot()).toMatchObject({
    structuredFields: {
      cardNumber: "4111 1111 1111 5678",
    },
    title: "Credit Card ending in 5678",
  });

  await write;
  expect(persistence.getState().document).toMatchObject({
    title: "Credit Card ending in 5678",
  });
});

test("document store does not replay intermediate structured fields during queued edits", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    "queued-structured-card",
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

  const originalSaveDocument = persistence.saveDocument;
  const releaseFirstEditSave = createDeferred();
  const releaseSecondEditSave = createDeferred();
  let editSaveCount = 0;

  persistence.saveDocument = async (...args) => {
    editSaveCount += 1;
    if (editSaveCount === 1) {
      await releaseFirstEditSave.promise;
    } else if (editSaveCount === 2) {
      await releaseSecondEditSave.promise;
    }

    return originalSaveDocument(...args);
  };

  const firstWrite = store.setStructuredFields("credit_card", {
    cardNumber: "4111",
  });
  const secondWrite = store.setStructuredFields("credit_card", {
    cardNumber: "4112",
  });

  expect(store.getSnapshot()).toMatchObject({
    structuredFields: {
      cardNumber: "4112",
    },
  });

  releaseFirstEditSave.resolve();
  await waitForCondition(
    () => editSaveCount === 2,
    "Second queued structured field save did not start.",
  );

  expect(store.getSnapshot()).toMatchObject({
    structuredFields: {
      cardNumber: "4112",
    },
  });

  releaseSecondEditSave.resolve();
  await Promise.all([firstWrite, secondWrite]);

  expect(store.getSnapshot()).toMatchObject({
    structuredFields: {
      cardNumber: "4112",
    },
  });
  expect(persistence.getState().document).toMatchObject({
    title: "Credit Card ending in 4112",
  });
});

test("document store persists structured field edits as Loro updates", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    "structured-card",
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

  store.setStructuredFields("credit_card", {
    cardNumber: "4111 1111 1111 1234",
    expirationDate: "2030-05",
  });

  await waitForCondition(
    () =>
      persistence.getState().document?.title === "Credit Card ending in 1234" &&
      persistence.getState().pendingUpdates.length === 2,
    "Structured document fields were not persisted.",
  );

  expect(store.getSnapshot()).toMatchObject({
    documentKind: "credit_card",
    fieldValidationIssues: [],
    structuredFields: {
      cardNumber: "4111 1111 1111 1234",
      cvvCode: "",
      expirationDate: "2030-05",
      issuer: "",
      nameOnCard: "",
    },
    text: "",
    title: "Credit Card ending in 1234",
  });
  expect(persistence.getState().document).toMatchObject({
    documentKind: "credit_card",
    text: "",
    title: "Credit Card ending in 1234",
  });

  const reloadedRuntime = createDocumentStoreRuntime();
  const reloadedStore = createDocumentStore(
    "structured-card",
    reloadedRuntime,
    persistence,
  );
  reloadedStore.updateRuntime(reloadedRuntime);

  await waitForCondition(
    () =>
      reloadedStore.getSnapshot().ready &&
      reloadedStore.getSnapshot().title === "Credit Card ending in 1234",
    "Reloaded structured document store did not read persisted Loro fields.",
  );

  expect(reloadedStore.getSnapshot()).toMatchObject({
    documentKind: "credit_card",
    structuredFields: {
      cardNumber: "4111 1111 1111 1234",
      cvvCode: "",
      expirationDate: "2030-05",
      issuer: "",
      nameOnCard: "",
    },
    text: "",
    title: "Credit Card ending in 1234",
  });
});

test("document store initializes before immediate structured field edits", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    "immediate-structured-card",
    runtime,
    persistence,
    null,
    "",
    "credit_card",
  );

  store.updateRuntime(runtime);

  await store.setStructuredFields("credit_card", {
    cardNumber: "4111 1111 1111 9876",
  });

  expect(store.getSnapshot()).toMatchObject({
    ready: true,
    structuredFields: {
      cardNumber: "4111 1111 1111 9876",
    },
    title: "Credit Card ending in 9876",
  });
  expect(persistence.getState().document).toMatchObject({
    title: "Credit Card ending in 9876",
  });
});

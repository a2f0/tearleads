import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk/stores/documents";
import {
  createDocumentStorePersistence,
  createDocumentStoreRuntime,
} from "../../../../test/helpers/documentStoreFixtures";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

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
      nameOnCard: "",
    },
    text: "",
    title: "Credit Card ending in 1234",
  });
});

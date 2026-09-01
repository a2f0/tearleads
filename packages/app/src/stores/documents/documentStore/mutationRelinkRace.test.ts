import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import {
  createDocumentStorePersistence,
  createDocumentStoreRuntime,
} from "../../../../test/helpers/documentStoreFixtures";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

function createMutationCommitRelinkRace(localId: string) {
  const basePersistence = createDocumentStorePersistence();
  let relinkBeforeNextCommit = false;
  const persistence = {
    ...basePersistence,
    async commitDocumentMutation(
      ...input: Parameters<typeof basePersistence.commitDocumentMutation>
    ) {
      if (relinkBeforeNextCommit) {
        relinkBeforeNextCommit = false;
        await basePersistence.relinkPersistedDocument(input[0], {
          accessEpoch: 2,
          containerId: "replacement-container",
          documentId: "replacement-document",
          localId,
        });
      }
      return basePersistence.commitDocumentMutation(...input);
    },
  };

  return {
    basePersistence,
    persistence,
    relinkBeforeNextCommit: () => {
      relinkBeforeNextCommit = true;
    },
  };
}

test("a text commit that loses a post-prepare relink queues no stale update", async () => {
  const localId = "text-enqueue-relink-race";
  const { basePersistence, persistence, relinkBeforeNextCommit } =
    createMutationCommitRelinkRace(localId);
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(localId, runtime, persistence);
  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "Text relink-race store did not become ready.",
  );
  const pendingCount = basePersistence.getState().pendingUpdates.length;

  relinkBeforeNextCommit();
  await store.setText("stale identity text");

  expect(store.getSnapshot()).toMatchObject({
    documentId: "replacement-document",
    text: "",
  });
  expect(basePersistence.getState().document).toMatchObject({
    documentId: "replacement-document",
    text: "",
  });
  expect(basePersistence.getState().pendingUpdates).toHaveLength(pendingCount);
});

test("a structured commit losing a post-prepare relink queues no stale update", async () => {
  const localId = "structured-enqueue-relink-race";
  const { basePersistence, persistence, relinkBeforeNextCommit } =
    createMutationCommitRelinkRace(localId);
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    localId,
    runtime,
    persistence,
    null,
    "",
    "credit_card",
  );
  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "Structured relink-race store did not become ready.",
  );
  const pendingCount = basePersistence.getState().pendingUpdates.length;

  relinkBeforeNextCommit();
  await store.setStructuredFields("credit_card", {
    cardNumber: "4111 1111 1111 1234",
  });

  expect(store.getSnapshot()).toMatchObject({
    documentId: "replacement-document",
    structuredFields: { cardNumber: "" },
  });
  expect(basePersistence.getState().document?.title).not.toBe(
    "Credit Card ending in 1234",
  );
  expect(basePersistence.getState().pendingUpdates).toHaveLength(pendingCount);
});

test("a row commit losing a post-prepare relink queues no stale update", async () => {
  const localId = "row-enqueue-relink-race";
  const { basePersistence, persistence, relinkBeforeNextCommit } =
    createMutationCommitRelinkRace(localId);
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    localId,
    runtime,
    persistence,
    null,
    "",
    "blood_pressure",
  );
  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "Row relink-race store did not become ready.",
  );
  const pendingCount = basePersistence.getState().pendingUpdates.length;

  relinkBeforeNextCommit();
  await store.addRow({ diastolic: "80", systolic: "120" });

  expect(store.getSnapshot()).toMatchObject({
    documentId: "replacement-document",
    rows: [],
  });
  expect(basePersistence.getState().pendingUpdates).toHaveLength(pendingCount);
});

test("a no-op text write still adopts a relinked identity", async () => {
  const localId = "text-noop-relink-race";
  const { persistence, relinkBeforeNextCommit } =
    createMutationCommitRelinkRace(localId);
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(localId, runtime, persistence);
  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "No-op text relink-race store did not become ready.",
  );

  relinkBeforeNextCommit();
  await store.setText("");

  expect(store.getSnapshot()).toMatchObject({
    documentId: "replacement-document",
    text: "",
  });
});

test("a no-op structured write still adopts a relinked identity", async () => {
  const localId = "structured-noop-relink-race";
  const { persistence, relinkBeforeNextCommit } =
    createMutationCommitRelinkRace(localId);
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    localId,
    runtime,
    persistence,
    null,
    "",
    "credit_card",
  );
  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "No-op structured relink-race store did not become ready.",
  );

  relinkBeforeNextCommit();
  await store.setStructuredFields("credit_card", { cardNumber: "" });

  expect(store.getSnapshot().documentId).toBe("replacement-document");
});

test("a no-op row write still adopts a relinked identity", async () => {
  const localId = "row-noop-relink-race";
  const { persistence, relinkBeforeNextCommit } =
    createMutationCommitRelinkRace(localId);
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    localId,
    runtime,
    persistence,
    null,
    "",
    "blood_pressure",
  );
  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "No-op row relink-race store did not become ready.",
  );

  relinkBeforeNextCommit();
  await store.updateRowFields("missing-row", { systolic: "120" });

  expect(store.getSnapshot()).toMatchObject({
    documentId: "replacement-document",
    rows: [],
  });
});

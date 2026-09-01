import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  createDocumentStorePersistence,
  createDocumentStoreRuntime,
} from "../../../../test/helpers/documentStoreFixtures";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("document store preserves local state when a purge proof is unavailable", async () => {
  const persistence = createDocumentStorePersistence();
  const offlineRuntime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    "purged-remote-note",
    offlineRuntime,
    persistence,
    "remote-purged-document",
  );
  store.updateRuntime(offlineRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Remote document store did not initialize before queuing an edit.",
  );

  await store.setText("queued edit");

  await waitForCondition(
    () =>
      persistence.getState().document?.documentId ===
        "remote-purged-document" &&
      persistence.getState().pendingUpdates.length === 1,
    "Remote document edit was not queued locally before reconnect.",
  );

  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const reportedErrors: string[] = [];
  const purgeProofCalls: string[] = [];
  const projectionResultCalls: string[] = [];
  const onlineRuntime = createDocumentStoreRuntime({
    apiClient: createMockApiClient({
      getDocumentPurgeProof: async (documentId) => {
        purgeProofCalls.push(documentId);
        return null;
      },
      getDocumentWriterProjectionResult: async (documentId) => {
        projectionResultCalls.push(documentId);
        // The positively-coded deletion 404 the API emits for a purged
        // document; a bare 404 no longer authorizes the local teardown.
        return {
          code: "document_not_found",
          kind: "http",
          message: `GET /documents/${documentId}/writer-projection: 404 Not Found: Document not found`,
          method: "GET",
          ok: false,
          path: `/documents/${documentId}/writer-projection`,
          report: () => {
            reportedErrors.push(documentId);
          },
          status: 404,
          statusText: "Not Found",
        };
      },
      syncDocumentResult: async () => {
        throw new Error("Unexpected document sync after projection 404");
      },
    }),
    auth: {
      isAuthenticated: true,
      organizationId: "organization-1",
      userId: "user-1",
    },
    crypto: {
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      signingFingerprint,
      signingKeyPair,
    },
    state: {
      domainScope: offlineRuntime.state.domainScope,
      online: true,
    },
  });
  store.updateRuntime(onlineRuntime);
  store.requestSync();

  await waitForCondition(
    () => projectionResultCalls.length === 1 && !store.getSnapshot().syncing,
    "Unproven purge did not finish the document sync pass.",
  );

  expect(persistence.getState().document).not.toBeNull();
  expect(persistence.getState().pendingUpdates).toHaveLength(1);
  expect(store.getSnapshot().ready).toBe(true);
  expect(projectionResultCalls).toEqual(["remote-purged-document"]);
  expect(purgeProofCalls).toEqual(["remote-purged-document"]);
  expect(reportedErrors).toEqual([]);
});

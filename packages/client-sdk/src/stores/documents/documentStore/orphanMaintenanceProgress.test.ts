import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
  reclaimDocumentOrphanBlobs,
} from "../../../workflows/documents";
import { discardDocumentStoreLocalState } from "./discard";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState } from "./state";

test("discard finishes while a later reclaim batch waits for byte storage", async () => {
  const { close, execSql } = await createTestExecSql(
    "discard-reclaim-progress",
  );
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const blobStore = createMemoryBlobStore();
  let deletes = 0;
  const logs: string[] = [];
  const deleteBytes = blobStore.deleteBytes.bind(blobStore);
  blobStore.deleteBytes = async (key) => {
    deletes += 1;
    if (deletes === 1) await new Promise((resolve) => setTimeout(resolve, 260));
    else {
      entered.resolve();
      await release.promise;
    }
    await deleteBytes(key);
  };
  const runtime = createDocumentsWorkflowRuntime({
    apiClient: {} as DocumentsWorkflowRuntimeInput["apiClient"],
    auth: { isAuthenticated: false, organizationId: null, userId: null },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: false,
    },
    util: {
      log: (message) => {
        logs.push(message);
      },
      reportSecurityIncident: async () => undefined,
    },
  });
  let discard: Promise<boolean> | undefined;
  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      containerId: "folder",
      documentId: "remote",
      documentKind: "note",
      id: "local",
      snapshotEndVersion: "",
      text: "",
      title: "Note",
    });
    await execSql(
      "INSERT INTO document_orphan_blob_reclaims (storage_key) VALUES ('first'), ('second')",
    );
    const state = createDocumentStoreState(
      "local",
      runtime,
      defaultDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      null,
    );
    let finished = false;
    discard = discardDocumentStoreLocalState(state, "remote").then((result) => {
      finished = true;
      return result;
    });
    await entered.promise;
    expect(finished).toBe(true);
    expect(state.initialized).toBe(false);
  } finally {
    release.resolve();
    await discard;
    await reclaimDocumentOrphanBlobs(runtime);
    close();
  }
});

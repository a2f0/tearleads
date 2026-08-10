import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type {
  DocumentRecord,
  DocumentsPersistence,
} from "../../../workflows/documents";
import type { DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { chainIdentityWrite } from "./identityWriteChain";
import { createDocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { deleteUpstreamDeletedDocument } from "./syncRequest";

test("a deletion response waits behind relink and cannot delete the new identity", async () => {
  const currentDoc = await createDocument("deletion-relink-document");
  const execSql = (async () => []) as ExecSql;
  const requestRecord = {
    accessEpoch: 1,
    containerId: "container-a",
    documentId: "document-a",
    id: "local-document",
  } as DocumentRecord;
  const deletedLocalIds: string[] = [];
  const persistence = {
    deleteDocument: async (_execSql: ExecSql, localId: string) => {
      deletedLocalIds.push(localId);
    },
  } as unknown as DocumentsPersistence;
  const runtime = {
    infra: {
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: { domainScope: createDomainScope() },
    util: { log: () => undefined },
  } as unknown as DocumentsRuntime;
  const state = createDocumentStoreState(
    requestRecord.id,
    runtime,
    persistence,
    noopDocumentStorePersistenceEffects,
    requestRecord.documentId,
  );
  state.doc = currentDoc;
  state.initialized = true;
  state.record = requestRecord;
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) throw new Error("Expected a live sync generation");

  let releaseRelink: () => void = () => undefined;
  const relinkBlocked = new Promise<void>((resolve) => {
    releaseRelink = resolve;
  });
  let signalRelinkStarted: () => void = () => undefined;
  const relinkStarted = new Promise<void>((resolve) => {
    signalRelinkStarted = resolve;
  });
  const relink = chainIdentityWrite(state, async () => {
    signalRelinkStarted();
    await relinkBlocked;
    state.record = {
      ...requestRecord,
      containerId: "container-b",
      documentId: "document-b",
    };
  });
  await relinkStarted;

  const deletion = deleteUpstreamDeletedDocument(
    state,
    generation,
    requestRecord,
    requestRecord.documentId ?? "",
  );
  releaseRelink();
  await Promise.all([relink, deletion]);

  expect(deletedLocalIds).toEqual([]);
  expect(state.doc).toBe(currentDoc);
  expect(state.record?.documentId).toBe("document-b");
  expect(state.initialized).toBe(true);
});

import { expect, test } from "bun:test";
import { createDocument } from "@symcrypt/loro";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { DocumentStoreState } from "./state";
import {
  captureDocumentStoreRemoteSyncRequestGeneration,
  captureDocumentStoreSyncGeneration,
  didDocumentStoreRemoteSyncRequestComplete,
  invalidateDocumentStoreRemoteSync,
  isDocumentStoreRemoteSyncRequestGenerationCurrent,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

test("sync generation invalidates on document, domain, database, or trust replacement", async () => {
  const currentDoc = await createDocument("sync-generation-current");
  const execSql = (async () => []) as ExecSql;
  const resolveProjectionUserKey = async () => null;
  const state = {
    doc: currentDoc,
    localWriteGeneration: 0,
    resolveProjectionUserKey,
    runtime: {
      infra: { execSql },
      state: { domainScope: createDomainScope() },
    },
  } as unknown as DocumentStoreState;
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  expect(generation).not.toBeNull();
  if (!generation) return;

  expect(isDocumentStoreSyncGenerationCurrent(state, generation)).toBe(true);

  state.doc = await createDocument("sync-generation-replacement");
  expect(isDocumentStoreSyncGenerationCurrent(state, generation)).toBe(false);
  state.doc = currentDoc;

  const runtime = state.runtime;
  state.runtime = {
    ...runtime,
    state: { ...runtime.state, domainScope: createDomainScope() },
  };
  expect(isDocumentStoreSyncGenerationCurrent(state, generation)).toBe(false);
  state.runtime = runtime;

  state.runtime = {
    ...runtime,
    infra: { ...runtime.infra, execSql: (async () => []) as ExecSql },
  };
  expect(isDocumentStoreSyncGenerationCurrent(state, generation)).toBe(false);
  state.runtime = runtime;

  state.resolveProjectionUserKey = async () => null;
  expect(isDocumentStoreSyncGenerationCurrent(state, generation)).toBe(false);
});

test("reset or relink sequence reuse cannot complete an old remote request", async () => {
  const state = {
    doc: await createDocument("remote-request-generation"),
    localWriteGeneration: 0,
    remoteUpdateCompletedSignalSeq: 1,
    resolveProjectionUserKey: async () => null,
    runtime: {
      infra: { execSql: (async () => []) as ExecSql },
      state: { domainScope: createDomainScope() },
    },
  } as unknown as DocumentStoreState;
  const beforeReset = captureDocumentStoreRemoteSyncRequestGeneration(state);
  expect(
    isDocumentStoreRemoteSyncRequestGenerationCurrent(state, beforeReset),
  ).toBe(true);
  expect(didDocumentStoreRemoteSyncRequestComplete(state, beforeReset, 1)).toBe(
    true,
  );

  state.localWriteGeneration += 1;
  state.remoteUpdateCompletedSignalSeq = 0;
  // A different document may reuse sequence 1 after reset.
  state.remoteUpdateCompletedSignalSeq = 1;
  expect(didDocumentStoreRemoteSyncRequestComplete(state, beforeReset, 1)).toBe(
    false,
  );

  const beforeRelink = captureDocumentStoreRemoteSyncRequestGeneration(state);
  invalidateDocumentStoreRemoteSync(state);
  // A post-relink sync can also complete at the same sequence.
  state.remoteUpdateCompletedSignalSeq = 1;
  expect(
    didDocumentStoreRemoteSyncRequestComplete(state, beforeRelink, 1),
  ).toBe(false);
});

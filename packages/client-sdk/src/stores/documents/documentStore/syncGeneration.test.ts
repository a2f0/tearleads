import { expect, test } from "bun:test";
import { createDocument } from "@symcrypt/loro";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { DocumentStoreState } from "./state";
import {
  captureDocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

test("sync generation invalidates on document, domain, database, or trust replacement", async () => {
  const currentDoc = await createDocument("sync-generation-current");
  const execSql = (async () => []) as ExecSql;
  const resolveProjectionUserKey = async () => null;
  const state = {
    doc: currentDoc,
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

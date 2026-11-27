import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentVerdictJudge } from "../../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  HELD_FRONTIER as FRONTIER,
  holdListedRecord,
  saveHeldCursor,
  saveHeldHead,
} from "../../../../data/persistence/documents/documentListingRevalidation.testUtils";
import { DocumentListingRevalidationRepository } from "../../../../data/persistence/documents/documentListingRevalidationRepository";
import {
  createDomainScope,
  type DomainScope,
} from "../../../../data/shared/domainScope";
import { documentTables } from "../../../../data/sqlite/schema/documentRecordSchema";
import {
  type ExecSql,
  ensureSqlTables,
} from "../../../../data/sqlite/sqlSchema";
import { getOrCreateDocumentListingCoverage } from "../../listingCoverage";
import type { DocumentsRuntime } from "../../types";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import {
  createDocumentStoreState,
  type DocumentStoreState,
  resetDocumentStore,
} from "../state";
import { createFreshPeerStoredDocument } from "../storedDocument";
import {
  findOwedListingReadBeforePull,
  isDocumentStoreCoveredByListing,
  loadDocumentListingCoverage,
  settleOwedListingReadAfterCompletedPull,
} from "./listingCoverage";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const LOCAL_ID = "local-1";
const CONTAINER_ID = "container-1";
const COMPLETE_PULL = { hasHeldPull: false, hasIncompletePull: false };

let close: () => void = () => undefined;
let execSql: ExecSql;
let domainScope: DomainScope;
let removeAuthority: () => void = () => undefined;

beforeEach(async () => {
  const database = await createTestExecSql(`coverage-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  domainScope = createDomainScope();
  removeAuthority = getOrCreateDocumentListingCoverage(domainScope).install({
    listsContainer: (containerId) => containerId === CONTAINER_ID,
  });
});

afterEach(() => {
  removeAuthority();
  close();
});

const LOADED_RECORD = {
  containerId: CONTAINER_ID,
  contentKeyBundle: "bundle",
  documentId: DOCUMENT_ID,
  documentKekTargets: "targets",
  documentManifestBundle: "manifest",
  lastCommitLsn: "0/1",
  pullContinuationRecoveryRequired: false,
  snapshotEndVersion: FRONTIER,
} as unknown as NonNullable<DocumentStoreState["record"]>;

/** A loaded store for the remote record held on disk. */
async function createLoadedStore() {
  const delayedSyncs: number[] = [];
  const runtime = {
    apiClient: {},
    auth: undefined,
    infra: { blobStore: {}, documentProjectors: {}, execSql },
    resolveTrustedUserIdentity: async () => null,
    util: { log: () => undefined },
    state: {
      containerId: CONTAINER_ID,
      domainScope,
      events: [],
      peerScope: "p",
    },
  } as unknown as DocumentsRuntime;
  const state = createDocumentStoreState(
    LOCAL_ID,
    runtime,
    {} as never,
    noopDocumentStorePersistenceEffects,
    DOCUMENT_ID,
  );
  state.record = LOADED_RECORD;
  state.doc = await createFreshPeerStoredDocument();
  state.syncLane = {
    requestSync: () => undefined,
    requestSyncAfter: (delayMs) => {
      delayedSyncs.push(delayMs);
    },
  };
  return { delayedSyncs, state };
}

function load(state: DocumentStoreState) {
  return loadDocumentListingCoverage(state, LOADED_RECORD, () => true);
}

function generationOf(state: DocumentStoreState) {
  const generation = captureDocumentStoreSyncGeneration(state, state.doc);
  if (!generation) throw new Error("Expected a sync generation");
  return generation;
}

test("a reset store that reloads over a cursor it can send again is covered", async () => {
  // The device upgraded since the pull that saved this cursor, so the next
  // pull withholds it.
  await holdListedRecord(execSql, {
    cursor: { count: 3, judge: "void-rules-older:loro-crdt@older" },
    documentId: DOCUMENT_ID,
    localId: LOCAL_ID,
  });
  const { state } = await createLoadedStore();
  expect(await load(state)).toBe(false);

  // Another runtime sharing the database pulled and saved a cursor the
  // running judge reached; this store was then reset and reloads.
  await saveHeldCursor(execSql, LOCAL_ID, {
    cursor: { count: 3, judge: documentVerdictJudge() },
    documentId: DOCUMENT_ID,
  });
  const doc = state.doc;
  resetDocumentStore(state);
  state.record = LOADED_RECORD;
  state.doc = doc;

  expect(await load(state)).toBe(true);
  expect(isDocumentStoreCoveredByListing(state)).toBe(true);
});

test("a pull a replica answered from before the head moved pays no debt", async () => {
  await holdListedRecord(execSql, {
    cursor: { count: 3, judge: documentVerdictJudge() },
    documentId: DOCUMENT_ID,
    localId: LOCAL_ID,
  });
  // A listing showed the head moved past the record's bundle, at a count the
  // cursor already covers.
  await new DocumentListingRevalidationRepository(execSql).request([
    {
      accessEpoch: 2,
      documentId: DOCUMENT_ID,
      localId: LOCAL_ID,
      updateCount: 3,
    },
  ]);
  const { delayedSyncs, state } = await createLoadedStore();
  expect(await load(state)).toBe(false);
  const generation = generationOf(state);
  const owed = await findOwedListingReadBeforePull(state, generation, {
    documentId: DOCUMENT_ID,
    remoteProbe: false,
  });

  // The pull completed and saved the bundle of the head before the move.
  await settleOwedListingReadAfterCompletedPull(state, generation, {
    frontier: FRONTIER,
    owed,
    pull: COMPLETE_PULL,
  });
  expect(isDocumentStoreCoveredByListing(state)).toBe(false);
  expect(state.remoteUpdatePending).toBe(true);
  expect(delayedSyncs).toEqual([2_000]);

  // The later pull saved the bundle of the listed head.
  await saveHeldHead(execSql, LOCAL_ID, "head:moved", 2);
  await settleOwedListingReadAfterCompletedPull(state, generation, {
    frontier: FRONTIER,
    owed,
    pull: COMPLETE_PULL,
  });
  expect(isDocumentStoreCoveredByListing(state)).toBe(true);
  expect(
    await new DocumentListingRevalidationRepository(execSql).listOwed(),
  ).toEqual([]);
});

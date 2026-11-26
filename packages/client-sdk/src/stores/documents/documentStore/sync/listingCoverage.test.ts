import { afterEach, beforeEach, expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { addDocumentAttachments } from "../../../../data/documents/documentContent";
import { documentVerdictJudge } from "../../../../data/documents/shared/sync/documentUpdateVerdict";
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
import { createDocumentStoreState, type DocumentStoreState } from "../state";
import { createFreshPeerStoredDocument } from "../storedDocument";
import {
  findOwedListingReadBeforePull,
  isDocumentStoreCoveredByListing,
  loadDocumentListingCoverage,
  settleOwedListingReadAfterCompletedPull,
} from "./listingCoverage";
import { settleReadyStoreConnection } from "./storeRuntime";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const CONTAINER_ID = "container-1";
const FRONTIER = encodeVersionVectorCounters({ "7": 4 });
const SLOT_ID = "55555555-5555-4555-8555-555555555555";
const DIGEST = "a".repeat(64);
const COMPLETE_PULL = { hasHeldPull: false, hasIncompletePull: false };

let close: () => void = () => undefined;
let execSql: ExecSql;
let domainScope: DomainScope;
let events: unknown[];
let removeAuthority: () => void = () => undefined;

beforeEach(async () => {
  const database = await createTestExecSql(`coverage-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  domainScope = createDomainScope();
  events = [];
  removeAuthority = getOrCreateDocumentListingCoverage(domainScope).install({
    listsContainer: (containerId) => containerId === CONTAINER_ID,
  });
});

afterEach(() => {
  removeAuthority();
  close();
});

/** A loaded store for a remote record that has completed a pull. */
async function createLoadedStore(record: Record<string, unknown> = {}) {
  const doc = await createFreshPeerStoredDocument();
  const delayedSyncs: number[] = [];
  const runtime = {
    apiClient: {},
    auth: undefined,
    infra: { blobStore: {}, documentProjectors: {}, execSql },
    resolveTrustedUserIdentity: async () => null,
    util: { log: () => undefined },
    state: { containerId: CONTAINER_ID, domainScope, events, peerScope: "p" },
  } as unknown as DocumentsRuntime;
  const state = createDocumentStoreState(
    "local-1",
    runtime,
    {} as never,
    noopDocumentStorePersistenceEffects,
    DOCUMENT_ID,
  );
  state.record = {
    containerId: CONTAINER_ID,
    contentKeyBundle: "bundle",
    documentId: DOCUMENT_ID,
    documentKekTargets: "targets",
    documentManifestBundle: "manifest",
    lastCommitLsn: "0/1",
    pullContinuationRecoveryRequired: false,
    snapshotEndVersion: FRONTIER,
    ...record,
  } as unknown as DocumentStoreState["record"];
  state.doc = doc;
  state.syncLane = {
    requestSync: () => undefined,
    requestSyncAfter: (delayMs) => {
      delayedSyncs.push(delayMs);
    },
  };
  return { delayedSyncs, doc, state };
}

function load(state: DocumentStoreState) {
  const record = state.record;
  if (!record) throw new Error("Expected a loaded record");
  return loadDocumentListingCoverage(state, record, () => true);
}

function owe(updateCount: number) {
  return new DocumentListingRevalidationRepository(execSql).request([
    { documentId: DOCUMENT_ID, updateCount },
  ]);
}

/** The record and the cursor a completed pull left through `count` updates. */
async function saveCursor(count: number, judge = documentVerdictJudge()) {
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES ('documents', 'local-1', ?, ?, '2026-11-25T00:00:00.000Z')
     ON CONFLICT (app_kind, local_id) DO NOTHING`,
    [DOCUMENT_ID, FRONTIER],
  );
  await execSql(
    `INSERT INTO document_sync_progress (app_kind, local_id, document_id,
       through_update_id, through_update_count, through_version, judge)
     VALUES ('documents', 'local-1', ?, 'update', ?, ?, ?)
     ON CONFLICT (app_kind, local_id) DO UPDATE SET
       through_update_count = excluded.through_update_count`,
    [DOCUMENT_ID, count, FRONTIER, judge],
  );
}

function generationOf(state: DocumentStoreState) {
  const generation = captureDocumentStoreSyncGeneration(state, state.doc);
  if (!generation) throw new Error("Expected a sync generation");
  return generation;
}

test("a listed lane covers a record that completed a pull and owes nothing", async () => {
  const { state } = await createLoadedStore();

  expect(await load(state)).toBe(true);
  expect(isDocumentStoreCoveredByListing(state)).toBe(true);
});

test("a record whose cursor the running judge reached stays covered", async () => {
  await saveCursor(3);
  const { state } = await createLoadedStore();

  expect(await load(state)).toBe(true);
});

test("a record whose cursor another judge reached probes until a pull completes", async () => {
  // The device upgraded since the pull that saved this cursor. The next pull
  // withholds it and judges every update again, and no listing asks for
  // that pull: the row is behind its lane's watermark.
  await saveCursor(3, "void-rules-older:loro-crdt@older");
  const { state } = await createLoadedStore();

  expect(await load(state)).toBe(false);
  expect(isDocumentStoreCoveredByListing(state)).toBe(false);

  // A pull cut short judged nothing through to its bound.
  await settleOwedListingReadAfterCompletedPull(state, generationOf(state), {
    frontier: FRONTIER,
    owed: null,
    pull: { hasHeldPull: false, hasIncompletePull: true },
  });
  expect(isDocumentStoreCoveredByListing(state)).toBe(false);

  await settleOwedListingReadAfterCompletedPull(state, generationOf(state), {
    frontier: FRONTIER,
    owed: null,
    pull: COMPLETE_PULL,
  });
  expect(isDocumentStoreCoveredByListing(state)).toBe(true);
});

test("a record restored behind its cursor probes", async () => {
  await saveCursor(3);
  const { state } = await createLoadedStore({
    snapshotEndVersion: encodeVersionVectorCounters({ "7": 2 }),
  });

  expect(await load(state)).toBe(false);
});

test.each([
  ["has no remote id", { documentId: null }],
  ["never completed a pull", { lastCommitLsn: null }],
  ["must recover its pull", { pullContinuationRecoveryRequired: true }],
])("a record that %s is not covered", async (_name, record) => {
  const { state } = await createLoadedStore(record);

  expect(await load(state)).toBe(false);
});

test("a store without a listing authority is not covered", async () => {
  removeAuthority();
  expect(await load((await createLoadedStore()).state)).toBe(false);
});

test("the document's own container decides, not the one its store opened under", async () => {
  // Opened under the listed default container, but held in another one.
  const elsewhere = (await createLoadedStore({ containerId: "container-2" }))
    .state;
  expect(await load(elsewhere)).toBe(false);

  const unplaced = (await createLoadedStore({ containerId: null })).state;
  expect(await load(unplaced)).toBe(false);

  // Held in the listed container, whatever container the store opened under.
  const held = (await createLoadedStore()).state;
  held.runtime = {
    ...held.runtime,
    state: { ...held.runtime.state, containerId: "container-2" },
  };
  expect(await load(held)).toBe(true);
});

test("a lane that was not listed covers nothing until it is listed again", async () => {
  const coverage = getOrCreateDocumentListingCoverage(domainScope);
  const { state } = await createLoadedStore();

  coverage.reportLaneListed(CONTAINER_ID, false);
  expect(await load(state)).toBe(false);

  coverage.reportLaneListed(CONTAINER_ID, true);
  expect(await load(state)).toBe(true);
});

test("a hint that named the document before its record loaded uncovers that load", async () => {
  events.push({
    containerIds: [CONTAINER_ID],
    documentId: DOCUMENT_ID,
    type: "document_update_created",
    updateIds: ["update-1"],
  });
  const { state } = await createLoadedStore();

  // Nothing delivered the hint to this store, so its load must probe.
  expect(await load(state)).toBe(false);
  // The probe that load arms answers it; a later load is covered again.
  expect(await load(state)).toBe(true);
});

test("a document with an attachment copy still to fetch is not covered", async () => {
  const { doc, state } = await createLoadedStore();
  addDocumentAttachments(doc, [
    {
      byteLength: 3,
      contentSha256: DIGEST,
      mimeType: null,
      name: "photo.png",
      slotId: SLOT_ID,
    },
  ]);

  // Bytes download after a sync response, so this record needs its pull.
  expect(await load(state)).toBe(false);

  state.attachmentStorageKeyBySlotId = { [SLOT_ID]: "stored" };
  state.attachmentContentSha256BySlotId = { [SLOT_ID]: DIGEST };
  expect(await load(state)).toBe(true);
});

test("a read a listing owes uncovers the store until a pull pays it", async () => {
  await owe(3);
  await saveCursor(2);
  const { delayedSyncs, state } = await createLoadedStore();

  expect(await load(state)).toBe(false);

  const generation = generationOf(state);
  const owed = await findOwedListingReadBeforePull(state, generation, {
    documentId: DOCUMENT_ID,
    remoteProbe: false,
  });
  expect(owed?.advertisedUpdateCount).toBe(3);
  if (!owed) throw new Error("Expected the owed read");

  // A replica lagging the listing answered: the cursor counts two updates.
  await settleOwedListingReadAfterCompletedPull(state, generation, {
    frontier: FRONTIER,
    owed,
    pull: COMPLETE_PULL,
  });
  expect(isDocumentStoreCoveredByListing(state)).toBe(false);
  expect(state.remoteUpdatePending).toBe(true);
  expect(delayedSyncs).toHaveLength(1);

  // The same debt is retried once, not on every pass that finds it unpaid.
  state.remoteUpdatePending = false;
  await settleOwedListingReadAfterCompletedPull(state, generation, {
    frontier: FRONTIER,
    owed,
    pull: COMPLETE_PULL,
  });
  expect(state.remoteUpdatePending).toBe(false);
  expect(delayedSyncs).toHaveLength(1);

  // A pull that counted the third update pays the debt.
  await saveCursor(3);
  await settleOwedListingReadAfterCompletedPull(state, generation, {
    frontier: FRONTIER,
    owed,
    pull: COMPLETE_PULL,
  });
  expect(isDocumentStoreCoveredByListing(state)).toBe(true);
  expect(
    await new DocumentListingRevalidationRepository(execSql).find(DOCUMENT_ID),
  ).toBeNull();
});

test("a debt owed for a moved access head alone is paid by a completed pull", async () => {
  // The listing counted no update, so no cursor exists to cover the debt.
  await owe(0);
  const { delayedSyncs, state } = await createLoadedStore();
  expect(await load(state)).toBe(false);
  const generation = generationOf(state);
  const owed = await findOwedListingReadBeforePull(state, generation, {
    documentId: DOCUMENT_ID,
    remoteProbe: false,
  });
  if (!owed) throw new Error("Expected the owed read");

  // A pull that stopped short of its bound read no head to rely on.
  await settleOwedListingReadAfterCompletedPull(state, generation, {
    frontier: FRONTIER,
    owed,
    pull: { hasHeldPull: false, hasIncompletePull: true },
  });
  expect(isDocumentStoreCoveredByListing(state)).toBe(false);

  await settleOwedListingReadAfterCompletedPull(state, generation, {
    frontier: FRONTIER,
    owed,
    pull: COMPLETE_PULL,
  });
  expect(isDocumentStoreCoveredByListing(state)).toBe(true);
  expect(delayedSyncs).toHaveLength(0);
  expect(
    await new DocumentListingRevalidationRepository(execSql).find(DOCUMENT_ID),
  ).toBeNull();
});

test("a pass reads the debt only for a probe or a store that knows of one", async () => {
  const { state } = await createLoadedStore();
  expect(await load(state)).toBe(true);
  // A listing owes the read after the load, and asks the store to probe.
  await owe(1);
  const generation = generationOf(state);

  expect(
    await findOwedListingReadBeforePull(state, generation, {
      documentId: DOCUMENT_ID,
      remoteProbe: false,
    }),
  ).toBeNull();
  expect(
    (
      await findOwedListingReadBeforePull(state, generation, {
        documentId: DOCUMENT_ID,
        remoteProbe: true,
      })
    )?.advertisedUpdateCount,
  ).toBe(1);
  expect(isDocumentStoreCoveredByListing(state)).toBe(false);
});

/** Installs a reconnected runtime on a loaded store; reports what it asked. */
function reconnect(state: DocumentStoreState) {
  let scheduled = 0;
  settleReadyStoreConnection(state, () => scheduled++, {
    regainedSyncPrerequisites: false,
    serverEventsReconnected: true,
  });
  return { probed: state.remoteUpdatePending, scheduled };
}

test("a reconnect probes a store only when no listing covers it", async () => {
  const covered = (await createLoadedStore()).state;
  expect(await load(covered)).toBe(true);
  // The listing after the acknowledgement answers for it; local work still runs.
  expect(reconnect(covered)).toEqual({ probed: false, scheduled: 1 });

  const uncovered = (await createLoadedStore({ containerId: "container-2" }))
    .state;
  expect(await load(uncovered)).toBe(false);
  expect(reconnect(uncovered)).toEqual({ probed: true, scheduled: 1 });
});

test("a startup probe that waited on the connection still runs when it is covered", async () => {
  const { state } = await createLoadedStore();
  expect(await load(state)).toBe(true);
  state.startupProbe = { attempt: 1, status: "deferred" };

  expect(reconnect(state).probed).toBe(true);
});

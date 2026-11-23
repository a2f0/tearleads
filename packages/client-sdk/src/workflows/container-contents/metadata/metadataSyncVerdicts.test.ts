import { afterEach, beforeEach, expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { DocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import {
  type ContainerMetadataRecord,
  sqlContainerContentsPersistence,
} from "../../../data/persistence/container-contents/containerContentsPersistence";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { writeContainerMetadataValue } from "./containerMetadataDocument";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import { persistContainerMetadataStateFromRuntime } from "./metadataPersistence";
import {
  containerMetadataVerdictRecorder,
  readContainerMetadataProcessedCursor,
} from "./metadataSyncVerdicts";
import type { ContainerMetadataState } from "./metadataTypes";

const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440d00";
const VOID_ID = "550e8400-e29b-41d4-a716-446655440d01";
const THROUGH = "550e8400-e29b-41d4-a716-446655440d02";
const container = createContainerRecord({
  id: "container-verdicts",
  metadataDocumentId: DOCUMENT_ID,
  parentId: null,
});

let close: () => void = () => undefined;
let execSql: ExecSql;
let metadataState: ContainerMetadataState;
let storedRecord: ContainerMetadataRecord;

beforeEach(async () => {
  const database = await createTestExecSql(`verdicts-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  await ensureDocumentTables(execSql);
  const doc = await createDocument("metadata-verdicts");
  writeContainerMetadataValue(doc, { icon: null, name: "Shared" });
  storedRecord = createDocumentRecord({
    documentId: DOCUMENT_ID,
    id: container.id,
    lastCommitLsn: "0/1",
    metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
  });
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    container,
    storedRecord,
  );
  metadataState = { container, doc, record: storedRecord };
});

afterEach(() => close());

/** A completed metadata pull whose one served update was voided. */
function pageWithVoid(): SyncRemoteDocumentResult {
  const error = new DocumentSyncUpdateIsolationError({
    cause: new Error("declared span is false"),
    stage: "loro_metadata",
    updateId: VOID_ID,
  });
  return {
    contentKeyFingerprintsByEpoch: new Map([[1, "key-a"]]),
    decryptedUpdates: [],
    hasHeldPull: false,
    hasIncompletePull: false,
    plan: { documentId: DOCUMENT_ID, request: {} },
    response: { pullPage: { throughUpdateId: THROUGH } },
    voidedUpdates: [
      { contentKeyEpoch: 1, error, stage: "loro_metadata", updateId: VOID_ID },
    ],
  } as unknown as SyncRemoteDocumentResult;
}

/** Saves a pass as `finalizeContainerMetadataSync` does. */
async function settlePass(expectedRecord: ContainerMetadataRecord) {
  const verdicts = containerMetadataVerdictRecorder(
    container.id,
    pageWithVoid(),
  );
  const persisted = await persistContainerMetadataStateFromRuntime({
    commitSideEffect: verdicts.commitSideEffect,
    expectedSyncState: { pullContinuation: null, record: expectedRecord },
    metadataState,
    patch: { lastCommitLsn: "0/2" },
    persistence: sqlContainerContentsPersistence,
    runtime: { infra: { execSql } },
  });
  const reported: unknown[] = [];
  const cursorCleared = verdicts.settle((message) => {
    reported.push(message);
  });
  return { cursorCleared, persisted, reported };
}

function sendable(localVersionVector: string | null) {
  return readContainerMetadataProcessedCursor(execSql, {
    containerId: container.id,
    documentId: DOCUMENT_ID,
    localVersionVector,
  });
}

async function voidRows() {
  return execSql(
    "SELECT update_id FROM document_void_updates WHERE local_id = ?",
    [container.id],
  );
}

test("a settled metadata pass records its voids and cursor with its save", async () => {
  const frontier = encodeVersionVector(metadataState.doc);
  expect(await sendable(frontier)).toBeUndefined();

  const { cursorCleared, reported } = await settlePass(storedRecord);

  expect(reported).toEqual(["Documents: sync update voided"]);
  expect(cursorCleared).toBe(false);
  expect(await voidRows()).toEqual([{ update_id: VOID_ID }]);
  expect(await sendable(frontier)).toBe(THROUGH);
  // A raw-history pull carries none, nor does a frontier that lost the
  // state the cursor was recorded with.
  expect(await sendable(null)).toBeUndefined();
  const empty = await createDocument("metadata-verdicts-empty");
  expect(await sendable(encodeVersionVector(empty))).toBeUndefined();
});

test("a void a metadata pass already recorded is not reported again", async () => {
  await settlePass(storedRecord);
  const saved =
    await sqlContainerContentsPersistence.loadContainerMetadataRecord(
      execSql,
      container.id,
    );
  if (!saved) throw new Error("Expected the saved metadata record");

  const { reported } = await settlePass(saved);

  expect(reported).toEqual([]);
  expect(await sendable(encodeVersionVector(metadataState.doc))).toBe(THROUGH);
});

test("a metadata pass a concurrent save superseded records no verdicts or cursor", async () => {
  await sqlContainerContentsPersistence.saveContainer(execSql, container, {
    ...storedRecord,
    lastCommitLsn: "0/3",
  });

  const { persisted, reported } = await settlePass(storedRecord);

  expect(persisted?.pullContinuationSuperseded).toBe(true);
  expect(reported).toEqual([]);
  expect(await voidRows()).toEqual([]);
  expect(await sendable(encodeVersionVector(metadataState.doc))).toBe(
    undefined,
  );
});

test("a metadata cursor recorded under another judge is withheld", async () => {
  await settlePass(storedRecord);
  await execSql(
    "UPDATE document_sync_progress SET judge = 'void-rules-0:older-decoder' WHERE local_id = ?",
    [container.id],
  );

  expect(await sendable(encodeVersionVector(metadataState.doc))).toBe(
    undefined,
  );
});

test("a metadata save fails with the verdicts it could not record", async () => {
  const failing = persistContainerMetadataStateFromRuntime({
    commitSideEffect: async () => {
      throw new Error("verdicts not recorded");
    },
    expectedSyncState: { pullContinuation: null, record: storedRecord },
    metadataState,
    patch: { lastCommitLsn: "0/2" },
    persistence: sqlContainerContentsPersistence,
    runtime: { infra: { execSql } },
  });

  await expect(failing).rejects.toThrow("verdicts not recorded");
  const saved =
    await sqlContainerContentsPersistence.loadContainerMetadataRecord(
      execSql,
      container.id,
    );
  expect(saved?.lastCommitLsn).toBe("0/1");
});

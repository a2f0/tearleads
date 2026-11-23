import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { DocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { recordContainerMetadataVoids } from "./metadataIncomingUpdateIsolation";

const LOCAL_ID = "container-voids";
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440d00";
const UPDATE_ID = "550e8400-e29b-41d4-a716-446655440d01";

/** A metadata page whose one served update was voided at the metadata stage. */
function pageWithVoid(): SyncRemoteDocumentResult {
  const error = new DocumentSyncUpdateIsolationError({
    cause: new Error("declared span is false"),
    stage: "loro_metadata",
    updateId: UPDATE_ID,
  });
  return {
    contentKeyFingerprintsByEpoch: new Map([[1, "key-a"]]),
    decryptedUpdates: [],
    hasIncompletePull: false,
    plan: { documentId: DOCUMENT_ID, request: {} },
    response: { pullPage: { throughUpdateId: UPDATE_ID } },
    voidedUpdates: [
      {
        contentKeyEpoch: 1,
        error,
        stage: "loro_metadata",
        updateId: UPDATE_ID,
      },
    ],
  } as unknown as SyncRemoteDocumentResult;
}

async function seededDatabase() {
  const database = await createTestExecSql(
    `metadata-voids-${crypto.randomUUID()}`,
  );
  await ensureDocumentTables(database.execSql);
  await database.execSql(
    `INSERT INTO documents (app_kind, local_id, document_id, updated_at)
     VALUES ('container-metadata', ?, ?, '2026-11-22T00:00:00.000Z')`,
    [LOCAL_ID, DOCUMENT_ID],
  );
  return database;
}

function pass(execSql: ExecSql, reported: unknown[]) {
  return {
    isCurrent: () => true,
    runtime: {
      infra: { execSql },
      util: {
        logError: (message: string | Error) => {
          reported.push(message);
        },
      },
    },
  };
}

async function voidRows(execSql: ExecSql) {
  return (await execSql(
    "SELECT update_id FROM document_void_updates WHERE app_kind = 'container-metadata'",
  )) as { update_id: string }[];
}

test("a settled metadata page records its voids and reports each once", async () => {
  const { close, execSql } = await seededDatabase();
  try {
    const reported: unknown[] = [];
    const persisted = { record: { id: LOCAL_ID } };
    await recordContainerMetadataVoids(
      pass(execSql, reported),
      persisted,
      pageWithVoid(),
    );
    await recordContainerMetadataVoids(
      pass(execSql, reported),
      persisted,
      pageWithVoid(),
    );

    expect(await voidRows(execSql)).toEqual([{ update_id: UPDATE_ID }]);
    expect(reported).toEqual(["Documents: sync update voided"]);
  } finally {
    close();
  }
});

test("a superseded metadata page records and reports nothing", async () => {
  const { close, execSql } = await seededDatabase();
  try {
    const reported: unknown[] = [];
    await recordContainerMetadataVoids(
      pass(execSql, reported),
      { pullContinuationSuperseded: true, record: { id: LOCAL_ID } },
      pageWithVoid(),
    );

    expect(await voidRows(execSql)).toEqual([]);
    expect(reported).toEqual([]);
  } finally {
    close();
  }
});

test("a failure to record a saved page's voids is logged, not thrown", async () => {
  const reported: unknown[] = [];
  const failing: ExecSql = async () => {
    throw new Error("database unavailable");
  };

  await recordContainerMetadataVoids(
    pass(failing, reported),
    { record: { id: LOCAL_ID } },
    pageWithVoid(),
  );

  expect(reported).toEqual(["Container metadata: verdicts not recorded"]);
});

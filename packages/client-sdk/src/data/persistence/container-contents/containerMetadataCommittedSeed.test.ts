import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  type LoroMap,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentVerdictJudge } from "../../documents/shared/sync/documentUpdateVerdict";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { readSendableProcessedProgress } from "../documents/records/sendableProcessedCursor";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";
import { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

const CONTAINER_ID = "container-seeded";
const DOCUMENT_ID = "metadata-seeded";
const SEED_UPDATE_ID = "seed-update";
const scope = { appKind: CONTAINER_METADATA_APP_KIND, localId: CONTAINER_ID };

async function seededMetadata() {
  const doc = await createDocument("committed-seed-test");
  (doc.getMap("container") as LoroMap).set("name", "Seeded");
  doc.commit();
  return {
    frontier: encodeVersionVector(doc),
    metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
  };
}

function save(
  execSql: ExecSql,
  metadataUpdates: string,
  committedSeedUpdateId?: string,
) {
  return sqlContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "admin",
      icon: null,
      id: CONTAINER_ID,
      metadataDocumentId: DOCUMENT_ID,
      name: "Seeded",
      organizationId: "organization-1",
      parentId: null,
    },
    {
      accessEpoch: 1,
      accessStateHash: "access-seeded",
      documentId: DOCUMENT_ID,
      id: CONTAINER_ID,
      metadataUpdates,
      snapshotEndVersion: "",
    },
    committedSeedUpdateId === undefined ? undefined : { committedSeedUpdateId },
  );
}

function sendableProgress(execSql: ExecSql, frontier: string) {
  return readSendableProcessedProgress(
    getClientSQLitePersistenceRuntime(execSql).db,
    { documentId: DOCUMENT_ID, frontier, judge: documentVerdictJudge(), scope },
  );
}

async function withExecSql(
  name: string,
  run: (execSql: ExecSql) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql(name);
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await run(execSql);
  } finally {
    close();
  }
}

test("a save naming its committed seed records the cursor the seed stands for", async () => {
  await withExecSql("committed-seed-cursor", async (execSql) => {
    const { frontier, metadataUpdates } = await seededMetadata();
    await save(execSql, metadataUpdates, SEED_UPDATE_ID);

    await expect(sendableProgress(execSql, frontier)).resolves.toEqual({
      updateCount: 1,
      updateId: SEED_UPDATE_ID,
    });
  });
});

test("a save without a committed seed records no cursor", async () => {
  await withExecSql("committed-seed-absent", async (execSql) => {
    const { frontier, metadataUpdates } = await seededMetadata();
    await save(execSql, metadataUpdates);

    await expect(sendableProgress(execSql, frontier)).resolves.toBeUndefined();
  });
});

test("a scope that already keeps a cursor keeps it", async () => {
  await withExecSql("committed-seed-kept", async (execSql) => {
    const { frontier, metadataUpdates } = await seededMetadata();
    await save(execSql, metadataUpdates);
    await execSql(
      `INSERT INTO document_sync_progress
         (app_kind, local_id, document_id, through_update_id,
          through_update_count, through_version, judge)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        scope.appKind,
        CONTAINER_ID,
        DOCUMENT_ID,
        "pulled-update",
        3,
        frontier,
        documentVerdictJudge(),
      ],
    );
    await save(execSql, metadataUpdates, SEED_UPDATE_ID);

    await expect(sendableProgress(execSql, frontier)).resolves.toEqual({
      updateCount: 3,
      updateId: "pulled-update",
    });
  });
});

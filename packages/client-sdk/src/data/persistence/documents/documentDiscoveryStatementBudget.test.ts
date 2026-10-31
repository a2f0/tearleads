import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import type { DiscoveredDocumentInput } from "../../documents/documentSummary";
import { deriveStableDocumentId } from "../../documents/shared/stableDocumentId";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { advanceKeyingCheckpointsAtomically } from "../keyingCheckpoints/keyingCheckpointAdvancePersistence";
import {
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "./documentsPersistence";

function discoveredInputs(
  count: number,
  offset = 0,
): DiscoveredDocumentInput[] {
  return Array.from({ length: count }, (_, index) => ({
    accessEpoch: 1,
    containerId: "container-a",
    createdAt: `2026-10-30T00:00:${String(offset + index).padStart(2, "0")}.000Z`,
    documentId: `remote-${offset + index}`,
    linkedContainerIds: ["container-a"],
  }));
}

test("discovery upserts new and known documents in a fixed number of statements", async () => {
  const sqlite = await createTestExecSql("document-discovery-budget");
  const counted = countingExecSql(sqlite.execSql);
  // Warm the per-connection schema ensure so it is not counted.
  await sqlDocumentsPersistence.ensureSchema(counted.execSql);
  const discover = (inputs: DiscoveredDocumentInput[]) =>
    counted.count(() => upsertDiscoveredDocuments(counted.execSql, inputs));
  try {
    // BEGIN IMMEDIATE, the pending-create scan, one read each for purge
    // checkpoints, local ids, records with projections, and placement intents,
    // the documents, projection, and text upserts, COMMIT. The per-row walk
    // took 3 + 7N for new documents (227 at 32) and 3 + 8N for known ones (259).
    expect({
      newOne: await discover(discoveredInputs(1)),
      new32: await discover(discoveredInputs(32, 1)),
      known32: await discover(discoveredInputs(32, 1)),
    }).toEqual({ newOne: 10, new32: 10, known32: 10 });
  } finally {
    sqlite.close();
  }
});

async function seedDiscoveryFixture(execSql: ExecSql) {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await sqlDocumentsPersistence.saveDocument(
    execSql,
    {
      accessEpoch: 3,
      accessStateHash: "stored-hash",
      containerId: "container-old",
      documentId: "remote-known",
      id: "local-known",
      snapshotEndVersion: "frontier",
      text: "known text",
    },
    { updatedAt: "2026-10-01T00:00:00.000Z" },
  );
  await sqlDocumentsPersistence.saveDocument(
    execSql,
    {
      accessEpoch: 9,
      containerId: "container-stale",
      documentId: "remote-newer-epoch",
      id: "local-newer-epoch",
      snapshotEndVersion: "",
      text: "",
    },
    { updatedAt: "2026-10-02T00:00:00.000Z" },
  );
  await sqlDocumentsPersistence.saveDocument(
    execSql,
    {
      accessEpoch: 1,
      containerId: "private-container",
      documentId: null,
      id: "pending-create",
      snapshotEndVersion: "",
      text: "queued",
    },
    { updatedAt: "2026-10-03T00:00:00.000Z" },
  );
  await execSql(
    `INSERT INTO local_intents (id, lane, intent_type, subject_id,
       target_container_id, sync_status, created_at, updated_at)
     VALUES ('intent-1', 'document.placement', 'document.move',
       'remote-moving', 'container-target', 'pending', 'now', 'now')`,
  );
}

async function discoveryInputsFor(): Promise<DiscoveredDocumentInput[]> {
  const base = {
    accessEpoch: 4,
    containerId: "container-a",
    createdAt: "2026-10-30T00:00:00.000Z",
    linkedContainerIds: ["container-a", "container-old"],
  };
  return [
    { ...base, documentId: "remote-known", accessStateHash: "next-hash" },
    { ...base, documentId: "remote-new", effectiveAccessLevel: "read" },
    { ...base, documentId: "remote-newer-epoch" },
    {
      ...base,
      documentId: await deriveStableDocumentId("pending-create"),
    },
    { ...base, documentId: "remote-moving" },
  ];
}

async function dumpDocumentTables(execSql: ExecSql) {
  return {
    documents: await execSql(
      "SELECT * FROM documents ORDER BY app_kind, local_id",
    ),
    projection: await execSql(
      "SELECT * FROM document_projection ORDER BY local_id",
    ),
    text: await execSql(
      "SELECT * FROM document_projection_text ORDER BY local_id",
    ),
  };
}

test("set discovery stores and returns what one input at a time does", async () => {
  const batched = await createTestExecSql("document-discovery-set");
  const single = await createTestExecSql("document-discovery-single");
  try {
    await seedDiscoveryFixture(batched.execSql);
    await seedDiscoveryFixture(single.execSql);
    const inputs = await discoveryInputsFor();
    const batchedSummaries = await upsertDiscoveredDocuments(
      batched.execSql,
      inputs,
    );
    const singleSummaries = [];
    for (const input of inputs) {
      singleSummaries.push(
        await sqlDocumentsPersistence.upsertDiscoveredDocument(
          single.execSql,
          input,
        ),
      );
    }
    expect(batchedSummaries).toEqual(singleSummaries);
    expect(batchedSummaries.map((summary) => summary.id)).toEqual([
      "local-known",
      "remote-new",
      "local-newer-epoch",
      "pending-create",
      "remote-moving",
    ]);
    expect(batchedSummaries[4]?.containerId).toBe("container-target");
    expect(await dumpDocumentTables(batched.execSql)).toEqual(
      await dumpDocumentTables(single.execSql),
    );
  } finally {
    batched.close();
    single.close();
  }
});

test("a purged input fails the whole batch before anything commits", async () => {
  const sqlite = await createTestExecSql("document-discovery-set-purge");
  try {
    await sqlDocumentsPersistence.ensureSchema(sqlite.execSql);
    await advanceKeyingCheckpointsAtomically({
      access: [],
      documentPurgeCheckpoint: {
        documentId: "remote-1",
        documentManifestHash: "document-manifest-hash",
        organizationId: "organization",
        purgeEventHash: "purge-event-hash",
      },
      execSql: sqlite.execSql,
      policies: [],
    });
    await expect(
      upsertDiscoveredDocuments(sqlite.execSql, discoveredInputs(3)),
    ).rejects.toMatchObject({ code: "rollback" });
    await expect(
      sqlDocumentsPersistence.listDocuments(sqlite.execSql),
    ).resolves.toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("a repeated document id keeps the per-row walk", async () => {
  const sqlite = await createTestExecSql("document-discovery-set-duplicate");
  try {
    await sqlDocumentsPersistence.ensureSchema(sqlite.execSql);
    const [first] = discoveredInputs(1);
    if (!first) throw new Error("Missing input");
    const summaries = await upsertDiscoveredDocuments(sqlite.execSql, [
      first,
      { ...first, accessEpoch: 2, containerId: "container-b" },
    ]);
    expect(summaries.map((summary) => summary.id)).toEqual([
      "remote-0",
      "remote-0",
    ]);
    await expect(
      sqlDocumentsPersistence.loadDocument(sqlite.execSql, "remote-0"),
    ).resolves.toMatchObject({ accessEpoch: 2 });
  } finally {
    sqlite.close();
  }
});

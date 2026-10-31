import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import {
  discardRetainedContainerMetadata,
  listRetainedContainerMetadata,
} from "../../../data/persistence/container-contents/containerRecoveryPersistence";
import { documentPlacementIntentTables } from "../../../data/sqlite/schema";
import { ensureSqlTables } from "../../../data/sqlite/sqlTableSchema";
import { defaultContainerContentsPersistence as persistence } from "../containerPersistence";
import {
  insertTestPendingUpdate,
  saveTestSyncedContainer,
} from "../documentQueries/documentQueries.testFixtures";

const folderId = (index: number) => `folder-${String(index).padStart(2, "0")}`;

async function insertIntent(
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  row: {
    id: string;
    intentType: string;
    lane: string;
    subjectId: string;
    syncStatus?: string;
    targetContainerId: string;
  },
) {
  await execSql(
    `INSERT INTO local_intents (id, lane, intent_type, subject_id,
       target_container_id, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'now', 'now')`,
    [
      row.id,
      row.lane,
      row.intentType,
      row.subjectId,
      row.targetContainerId,
      row.syncStatus ?? "pending",
    ],
  );
}

/**
 * `count` retained folders, each with queued metadata edits; folder intents
 * on some, and placement intents that reach folders both as their target and
 * through link targets shared across folders.
 */
async function retainedFoldersFixture(name: string, count: number) {
  const database = await createTestExecSql(name);
  const { execSql } = database;
  await persistence.ensureSchema(execSql);
  await ensureSqlTables(execSql, documentPlacementIntentTables);
  for (let index = 0; index < count; index += 1) {
    const id = folderId(index);
    await saveTestSyncedContainer({
      accessLevel: "write",
      execSql,
      id,
      // Odd folders keep a record without a checkpoint snapshot.
      ...(index % 2 === 0 ? { metadataUpdates: `snapshot-${id}` } : {}),
      name: `Folder ${index}`,
      organizationId: "org",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    for (const edit of index % 2 === 0 ? [0, 1] : [0]) {
      await insertTestPendingUpdate({
        appKind: "container-metadata",
        createdAt: `2026-01-01T00:00:0${edit}.000Z`,
        execSql,
        id: `${id}-edit-${edit}`,
        localId: id,
      });
    }
    if (index % 3 === 0) {
      await insertIntent(execSql, {
        id: `${id}-create`,
        intentType: "container.create",
        lane: "container.create",
        subjectId: id,
        targetContainerId: "parent",
      });
      await insertIntent(execSql, {
        id: `${id}-move`,
        intentType: "container.move",
        lane: "container.move",
        subjectId: id,
        targetContainerId: "parent",
      });
    }
    await insertIntent(execSql, {
      id: `${id}-placement`,
      intentType: "document.link",
      lane: "document.placement",
      subjectId: `document-${index}`,
      targetContainerId: id,
    });
    // Link targets in this folder and the next one: the next folder reaches
    // this intent only through its link target.
    for (const containerId of [id, folderId(index + 1)]) {
      await execSql(
        "INSERT INTO document_intent_link_targets (intent_id, operation, container_id) VALUES (?, 'link', ?)",
        [`${id}-placement`, containerId],
      );
    }
  }
  await persistence.deleteContainers(
    execSql,
    Array.from({ length: count }, (_, index) => ({
      containerId: folderId(index),
      reason: "deleted" as const,
      updatedAt: "9999-01-01T00:00:00.000Z",
    })),
    { discoveryOnly: true },
  );
  return database;
}

test("retained folders list in a fixed number of statements", async () => {
  const counts: Record<string, number> = {};
  for (const count of [1, 4, 16]) {
    const f = await retainedFoldersFixture(`retained-listing-${count}`, count);
    try {
      const counted = countingExecSql(f.execSql);
      await persistence.ensureSchema(counted.execSql);
      await ensureSqlTables(counted.execSql, documentPlacementIntentTables);
      let listed = 0;
      counts[`folders${count}`] = await counted.count(async () => {
        listed = (await listRetainedContainerMetadata(counted.execSql, "org"))
          .length;
      });
      expect(listed).toBe(count);
    } finally {
      f.close();
    }
  }
  // BEGIN, the dormant select, three metadata reads, the create and move
  // reads, the placement intent and link target reads, COMMIT. The
  // per-folder reads took 3 + 9R: 12 / 39 / 147.
  expect(counts).toEqual({ folders1: 10, folders4: 10, folders16: 10 });
});

test("each listed revision is the token a discard of that folder accepts", async () => {
  const count = 4;
  const fixture = await retainedFoldersFixture(
    "retained-listing-tokens",
    count,
  );
  let listed: Awaited<ReturnType<typeof listRetainedContainerMetadata>>;
  const records: string[] = [];
  try {
    listed = await listRetainedContainerMetadata(fixture.execSql, "org");
    for (const folder of listed) {
      records.push(
        (
          await persistence.loadContainerMetadataRecord(
            fixture.execSql,
            folder.containerId,
          )
        )?.metadataUpdates ?? "",
      );
    }
  } finally {
    fixture.close();
  }
  expect(listed.map((folder) => folder.containerId)).toEqual(
    Array.from({ length: count }, (_, index) => folderId(index)),
  );
  expect(listed.map((folder) => folder.pendingUpdateCount)).toEqual([
    2, 1, 2, 1,
  ]);
  expect(listed.every((folder) => folder.hasStructuralIntent)).toBe(true);
  // The checkpoint snapshot already read is the record's metadata updates.
  expect(listed.map((folder) => folder.metadataUpdates)).toEqual(records);
  expect(records.filter((updates) => updates !== "")).toHaveLength(2);
  // A fresh database per folder: discarding one folder rewrites intents the
  // next folder's token covers.
  for (const { containerId } of listed) {
    const f = await retainedFoldersFixture(
      `retained-listing-token-${containerId}`,
      count,
    );
    try {
      const fresh = await listRetainedContainerMetadata(f.execSql, "org");
      const folder = fresh.find((entry) => entry.containerId === containerId);
      const other = fresh.find((entry) => entry.containerId !== containerId);
      if (!folder || !other) throw new Error("Missing listed folders");
      // A token is bound to its folder.
      expect(
        await discardRetainedContainerMetadata(f.execSql, {
          containerId,
          organizationId: "org",
          revision: other.revision,
        }),
      ).toBe(false);
      expect(
        await discardRetainedContainerMetadata(f.execSql, {
          containerId,
          organizationId: "org",
          revision: folder.revision,
        }),
      ).toBe(true);
    } finally {
      f.close();
    }
  }
});

import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { createInitializedContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import { defaultContainerContentsPersistence as persistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import {
  insertTestPendingUpdate,
  saveTestSyncedContainer,
} from "./documentQueries.testFixtures";

async function fixture() {
  const database = await createTestExecSql("folder-recovery");
  const execSql = database.execSql;
  await persistence.ensureSchema(execSql);
  await saveTestSyncedContainer({
    accessLevel: "write",
    execSql,
    id: "folder",
    name: "Preserved folder",
    organizationId: "org",
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  await insertTestPendingUpdate({
    appKind: "container-metadata",
    createdAt: "2026-01-01T00:00:01.000Z",
    execSql,
    id: "rename",
    localId: "folder",
  });
  const original = await persistence.loadContainerMetadataState(
    execSql,
    "folder",
  );
  if (!original) throw new Error("Missing fixture folder");
  if (!original.record) throw new Error("Missing metadata");
  const metadata = await createInitializedContainerMetadataDocument("folder", {
    name: "Preserved rename",
    icon: "folder",
  });
  await persistence.saveContainer(execSql, original.container, {
    ...original.record,
    metadataUpdates: bytesToBase64(metadata.initialUpdate),
  });
  metadata.doc.free();
  await persistence.deleteContainers(
    execSql,
    [
      {
        containerId: "folder",
        reason: "deleted",
        updatedAt: "9999-01-01T00:00:00.000Z",
      },
    ],
    { discoveryOnly: true },
  );
  return {
    ...database,
    original,
    queries: createContainerDocumentQueriesFromRuntime({ infra: { execSql } }),
  };
}

test("recovery lists preserved folder work and discards only the confirmed local copy", async () => {
  const f = await fixture();
  try {
    const [folder] = await f.queries.listRecoveryFolders({
      currentOrganizationId: "org",
    });
    expect(folder).toMatchObject({
      containerId: "folder",
      name: "Preserved rename",
      pendingUpdateCount: 1,
    });
    if (!folder) throw new Error("Recovery folder missing");
    expect(
      await f.queries.hasOrphanedDocuments({ currentOrganizationId: "org" }),
    ).toBe(true);
    expect(
      await f.queries.listRecoveryFolders({
        currentOrganizationId: "other-org",
      }),
    ).toEqual([]);
    expect(
      await f.queries.discardRecoveryFolder({
        ...folder,
        organizationId: "other-org",
      }),
    ).toBe(false);
    expect(await f.queries.discardRecoveryFolder(folder)).toBe(true);
    expect(
      await persistence.loadContainerMetadataRecord(f.execSql, "folder"),
    ).toBeNull();
    expect(await persistence.listPendingUpdates(f.execSql, "folder")).toEqual(
      [],
    );
    expect(
      await f.queries.listRecoveryFolders({ currentOrganizationId: "org" }),
    ).toEqual([]);
  } finally {
    f.close();
  }
});

test("a new edit invalidates an open discard confirmation", async () => {
  const f = await fixture();
  try {
    const [folder] = await f.queries.listRecoveryFolders({
      currentOrganizationId: "org",
    });
    if (!folder) throw new Error("Recovery folder missing");
    await insertTestPendingUpdate({
      appKind: "container-metadata",
      createdAt: "2026-01-01T00:00:02.000Z",
      execSql: f.execSql,
      id: "new-edit",
      localId: "folder",
    });
    expect(await f.queries.discardRecoveryFolder(folder)).toBe(false);
    expect(
      await persistence.listPendingUpdates(f.execSql, "folder"),
    ).toHaveLength(2);
  } finally {
    f.close();
  }
});

test("rehydration wins over a stale discard confirmation", async () => {
  const f = await fixture();
  try {
    const [folder] = await f.queries.listRecoveryFolders({
      currentOrganizationId: "org",
    });
    if (!folder) throw new Error("Recovery folder missing");
    await persistence.saveContainer(
      f.execSql,
      f.original.container,
      f.original.record,
    );
    expect(await f.queries.discardRecoveryFolder(folder)).toBe(false);
    expect(
      await persistence.loadContainerMetadataState(f.execSql, "folder"),
    ).not.toBeNull();
    expect(
      await persistence.listPendingUpdates(f.execSql, "folder"),
    ).toHaveLength(1);
  } finally {
    f.close();
  }
});

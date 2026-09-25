import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { createInitializedContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import { sqlDocumentMoveIntentPersistence as placementIntents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { defaultContainerContentsPersistence as persistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import {
  insertTestPendingUpdate,
  saveTestSyncedContainer,
} from "./documentQueries.testFixtures";

async function fixture(queued = true) {
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
  if (queued)
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
    name: queued ? "Preserved rename" : "Preserved folder",
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

test("clean synced removals leave only a hydration fence, without recovery clutter", async () => {
  const f = await fixture(false);
  try {
    expect(
      await f.queries.listRecoveryFolders({ currentOrganizationId: "org" }),
    ).toEqual([]);
    expect(
      await f.queries.hasOrphanedDocuments({ currentOrganizationId: "org" }),
    ).toBe(false);
    expect(
      await persistence.loadContainerMetadataRecord(f.execSql, "folder"),
    ).toBeNull();
    expect(
      await persistence.loadContainerHydrationTombstones(f.execSql),
    ).toHaveLength(1);
  } finally {
    f.close();
  }
});

test("retry bookkeeping does not invalidate discard but a changed move target does", async () => {
  const f = await fixture();
  try {
    await f.execSql(`INSERT INTO container_move_intents
      (id, container_id, parent_container_id, previous_parent_container_id, intent_type, sync_status, created_at, updated_at)
      VALUES ('move', 'folder', 'destination', 'source', 'container.move', 'pending', 'before', 'before')`);
    const [folder] = await f.queries.listRecoveryFolders({
      currentOrganizationId: "org",
    });
    if (!folder) throw new Error("Missing recovery folder");
    await f.execSql(
      `UPDATE container_move_intents SET sync_status = 'blocked', last_error = 'unavailable', last_attempted_at = 'after', updated_at = 'after'`,
    );
    const [retried] = await f.queries.listRecoveryFolders({
      currentOrganizationId: "org",
    });
    expect(retried?.revision).toBe(folder.revision);
    await f.execSql(
      `UPDATE container_move_intents SET parent_container_id = 'different'`,
    );
    expect(await f.queries.discardRecoveryFolder(folder)).toBe(false);
    const [changed] = await f.queries.listRecoveryFolders({
      currentOrganizationId: "org",
    });
    if (!changed) throw new Error("Missing changed folder");
    expect(await f.queries.discardRecoveryFolder(changed)).toBe(true);
  } finally {
    f.close();
  }
});

test.each([
  { extra: false, replaceLinkedContainers: false },
  { extra: true, replaceLinkedContainers: false },
  { extra: false, replaceLinkedContainers: true },
  { extra: true, replaceLinkedContainers: true },
])(
  "discard cancels placement while preserving other explicit links (%j)",
  async ({ extra, replaceLinkedContainers }) => {
    const f = await fixture();
    try {
      const input = {
        documentId: "remote-doc",
        localId: "local-doc",
        sourceContainerId: "source",
        targetContainerId: "folder",
      };
      await placementIntents.enqueueMoveIntent(f.execSql, {
        ...input,
        id: "move-document",
        replaceLinkedContainers,
      });
      await f.execSql(
        "INSERT INTO document_container_projection (document_id, container_id, updated_at) VALUES ('remote-doc', 'folder', 'before')",
      );
      if (extra) {
        await placementIntents.enqueueLinkIntent(f.execSql, {
          ...input,
          targetContainerId: "other-folder",
        });
        await placementIntents.enqueueUnlinkIntent(f.execSql, {
          ...input,
          removedContainerId: "unrelated-folder",
        });
      }
      const [folder] = await f.queries.listRecoveryFolders({
        currentOrganizationId: "org",
      });
      if (!folder) throw new Error("Missing recovery folder");
      expect(await f.queries.discardRecoveryFolder(folder)).toBe(true);
      await persistence.saveContainer(
        f.execSql,
        f.original.container,
        f.original.record,
      );
      expect(
        await f.execSql(
          "SELECT * FROM document_container_projection WHERE container_id = 'folder'",
        ),
      ).toEqual([]);
      const intents = await f.execSql(
        "SELECT id, intent_type, target_container_id, replace_linked_containers FROM document_move_intents",
      );
      if (extra) {
        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({
          intent_type: "document.link",
          target_container_id: "other-folder",
          replace_linked_containers: 0,
        });
        expect(Reflect.get(intents[0] ?? {}, "id")).not.toBe("move-document");
        expect(
          await f.execSql(
            "SELECT operation, container_id FROM document_intent_link_targets",
          ),
        ).toEqual([
          { operation: "link", container_id: "other-folder" },
          { operation: "unlink", container_id: "unrelated-folder" },
        ]);
      } else expect(intents).toEqual([]);
    } finally {
      f.close();
    }
  },
);

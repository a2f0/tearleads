import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentProjectorRegistry } from "../../../data/documents";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { isPauseRemovedDocument } from "../../sync";
import { saveTestSyncedContainer } from "../documentQueries/documentQueries.testFixtures";
import { listPendingWrites } from "../pendingWrites";
import { removeOrganizationContentUnlessPending } from "./documentRemoval";
import {
  placedDocument,
  preparePausedFolder,
  removeWithRealDeletion,
  UPDATED_AT,
} from "./documentRemoval.testFixtures";

async function withPausedFolder(
  run: (execSql: ExecSql, versions: readonly [string, string]) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql("sync-pause-removal");
  try {
    await run(execSql, await preparePausedFolder(execSql));
  } finally {
    close();
  }
}

function remove(
  execSql: ExecSql,
  deletedContainers: string[],
  options: {
    containersCurrent?: boolean;
    queuedEdits?: ReadonlySet<string>;
  } = {},
) {
  return removeOrganizationContentUnlessPending({
    containerIds: ["folder"],
    deleteContainers: async (_lockedExecSql, removals) => {
      if (options.containersCurrent === false) return [];
      deletedContainers.push(...removals.map((removal) => removal.containerId));
      return removals.map((removal) => removal.containerId);
    },
    documentProjectors: createDocumentProjectorRegistry([]),
    execSql,
    hasQueuedWrites: (localId) => options.queuedEdits?.has(localId) ?? false,
    organizationId: "org-paused",
    restoreDocument: () => undefined,
    retireDocument: () => undefined,
    stillCurrent: () => true,
  });
}

test("an edit kept only in the local history tail blocks the removal", async () => {
  await withPausedFolder(async (execSql, [uploaded, edited]) => {
    // Nothing is queued, but the stored content is ahead of what was uploaded:
    // a deferred edit that has not synced.
    await placedDocument(execSql, {
      localId: "deferred-edit",
      pendingBaseVersion: uploaded,
      snapshotEndVersion: edited,
    });
    expect(
      (await listPendingWrites(execSql)).some(
        (item) => item.localId === "deferred-edit",
      ),
    ).toBe(true);
    const deletedContainers: string[] = [];

    expect((await remove(execSql, deletedContainers)).status).toBe(
      "pending-writes",
    );
    expect(deletedContainers).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "deferred-edit"),
    ).not.toBeNull();
  });
});

test("an organization with nothing pending is removed with its documents", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "synced",
      snapshotEndVersion: synced,
    });
    const deletedContainers: string[] = [];

    expect(await remove(execSql, deletedContainers)).toEqual({
      deletedContainerIds: ["folder"],
      deletedLocalIds: ["synced"],
      status: "removed",
    });
    expect(deletedContainers).toEqual(["folder"]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "synced"),
    ).toBeNull();
    // Reopening it stays refused while the pause lasts, even after a restart.
    expect(await isPauseRemovedDocument(execSql, "synced")).toBe(true);
  });
});

test("an edit an open store has not yet persisted keeps the whole organization", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "open-document",
      snapshotEndVersion: synced,
    });
    const deletedContainers: string[] = [];

    expect(
      await remove(execSql, deletedContainers, {
        queuedEdits: new Set(["open-document"]),
      }),
    ).toEqual({
      deletedContainerIds: [],
      deletedLocalIds: [],
      status: "queued-edits",
    });
    // Nothing is detached: the folder and its document stay until the edit
    // persists and uploads.
    expect(deletedContainers).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "open-document"),
    ).not.toBeNull();
  });
});

test("documents stay when the containers' removal is no longer current", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "kept",
      snapshotEndVersion: synced,
    });

    expect(await remove(execSql, [], { containersCurrent: false })).toEqual({
      deletedContainerIds: [],
      deletedLocalIds: [],
      status: "interrupted",
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "kept"),
    ).not.toBeNull();
  });
});

test("each document's store retires as its deletion commits, before the next", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    for (const localId of ["first", "second"]) {
      await placedDocument(execSql, { localId, snapshotEndVersion: synced });
    }
    const events: string[] = [];

    const removal = await removeWithRealDeletion(
      execSql,
      ["folder"],
      (localId) => {
        events.push(`check:${localId}`);
        return false;
      },
      { retireDocument: (localId) => events.push(`retire:${localId}`) },
    );

    expect(removal.status).toBe("removed");
    // After the up-front scan, each document is checked when its guard
    // registers and again at its COMMIT, which alone retires its store, all
    // before the next document starts: an open editor turns read-only before
    // its document's deletion commits.
    expect(events.slice(2)).toEqual([
      "check:first",
      "check:first",
      "retire:first",
      "check:second",
      "check:second",
      "retire:second",
    ]);
  });
});

test("switching into the organization mid-removal keeps its documents", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "workspace-note",
      snapshotEndVersion: synced,
    });
    let current = true;
    const retired: string[] = [];

    const removal = await removeWithRealDeletion(
      execSql,
      ["folder"],
      () => false,
      {
        retireDocument: (localId) => retired.push(localId),
        // The session switches into the organization once the containers go.
        stillCurrent: () => {
          const wasCurrent = current;
          current = false;
          return wasCurrent;
        },
      },
    );

    expect(removal.status).toBe("interrupted");
    expect(retired).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "workspace-note"),
    ).not.toBeNull();
  });
});

test("an edit queued while a document's rows are deleted rolls the deletion back", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "late-edit",
      snapshotEndVersion: synced,
    });
    // The removal's own checks see no queued edit; one is queued while the
    // document's rows are being deleted, before the deletion commits.
    let checks = 0;
    expect(
      await removeWithRealDeletion(execSql, ["folder"], () => checks++ > 1),
    ).toEqual({
      deletedContainerIds: ["folder"],
      deletedLocalIds: [],
      status: "interrupted",
    });

    // A later pass leaves it like any document whose container was lost.
    expect(await removeWithRealDeletion(execSql, [])).toEqual({
      deletedContainerIds: [],
      deletedLocalIds: [],
      status: "removed",
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "late-edit"),
    ).not.toBeNull();
  });
});

test("documents already detached before the pause survive its removal", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    // A folder this device lost earlier left its document detached but still
    // attributed to the organization: possibly a copy a recovery still needs.
    await saveTestSyncedContainer({
      execSql,
      id: "lost-folder",
      name: "Lost",
      organizationId: "org-paused",
      timestamp: UPDATED_AT,
    });
    await placedDocument(execSql, {
      containerId: "lost-folder",
      localId: "recovery-copy",
      snapshotEndVersion: synced,
    });
    await sqlContainerContentsPersistence.deleteContainers(execSql, [
      {
        containerId: "lost-folder",
        reason: "access_revoked",
        updatedAt: UPDATED_AT,
      },
    ]);
    await placedDocument(execSql, {
      localId: "synced",
      snapshotEndVersion: synced,
    });

    expect(await removeWithRealDeletion(execSql, ["folder"])).toEqual({
      deletedContainerIds: ["folder"],
      deletedLocalIds: ["synced"],
      status: "removed",
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "recovery-copy"),
    ).not.toBeNull();
  });
});

test("a session switch before a document's COMMIT leaves its store writable", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "kept",
      snapshotEndVersion: synced,
    });
    const retired: string[] = [];
    // Current for the loop and the guard's registration, not at its COMMIT.
    let calls = 0;

    const removal = await removeWithRealDeletion(
      execSql,
      ["folder"],
      () => false,
      {
        retireDocument: (localId) => retired.push(localId),
        stillCurrent: () => ++calls <= 2,
      },
    );

    expect(removal.status).toBe("interrupted");
    expect(retired).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "kept"),
    ).not.toBeNull();
    // The removal record rolled back with the deletion.
    expect(await isPauseRemovedDocument(execSql, "kept")).toBe(false);
  });
});

test("a deletion that fails to commit after retiring restores the store", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "kept",
      snapshotEndVersion: synced,
    });
    const restored: string[] = [];

    await expect(
      removeWithRealDeletion(execSql, ["folder"], () => false, {
        restoreDocument: (localId) => restored.push(localId),
        retireDocument: () => {
          throw new Error("commit lost");
        },
      }),
    ).rejects.toThrow("commit lost");

    expect(restored).toEqual(["kept"]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "kept"),
    ).not.toBeNull();
  });
});

test("a failed read with nothing to upload does not block the removal", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "unread",
      snapshotEndVersion: synced,
    });
    // A remote read failed; the queue reports it, but it holds no local work.
    await execSql(
      "UPDATE documents SET sync_failure_message = ?, sync_failure_attempted_at = ? WHERE local_id = ?",
      ["Remote revalidation failed", UPDATED_AT, "unread"],
    );
    expect(
      (await listPendingWrites(execSql)).flatMap((item) =>
        item.operations.map((operation) => operation.kind),
      ),
    ).toEqual(["revalidation"]);

    expect((await remove(execSql, [])).status).toBe("removed");
  });
});

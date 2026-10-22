import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentProjectorRegistry } from "../../../data/documents";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { saveTestSyncedContainer } from "../documentQueries/documentQueries.testFixtures";
import { listPendingWrites } from "../pendingWrites";
import { removeOrganizationContentUnlessPending } from "./documentRemoval";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";

async function placedDocument(
  execSql: ExecSql,
  input: {
    localId: string;
    pendingBaseVersion?: string;
    snapshotEndVersion: string;
  },
): Promise<void> {
  const documentId = `${input.localId}-remote`;
  await sqlDocumentsPersistence.saveDocument(
    execSql,
    {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: "folder",
      documentId,
      documentKind: "note",
      id: input.localId,
      ...(input.pendingBaseVersion === undefined
        ? {}
        : { pendingBaseVersion: input.pendingBaseVersion }),
      snapshotEndVersion: input.snapshotEndVersion,
      text: "",
      title: input.localId,
    },
    { updatedAt: UPDATED_AT },
  );
  await execSql(
    "INSERT INTO document_container_projection (document_id, container_id, updated_at) VALUES (?, ?, ?)",
    [documentId, "folder", UPDATED_AT],
  );
}

async function withPausedFolder(
  run: (execSql: ExecSql, versions: readonly [string, string]) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql("sync-pause-removal");
  try {
    await listPendingWrites(execSql);
    await saveTestSyncedContainer({
      execSql,
      id: "folder",
      name: "Folder",
      organizationId: "org-paused",
      timestamp: UPDATED_AT,
    });
    const document = await createDocument("sync-pause-removal");
    document.getText("text").update("first");
    document.commit();
    const first = encodeVersionVector(document);
    document.getText("text").update("second");
    document.commit();
    await run(execSql, [first, encodeVersionVector(document)]);
  } finally {
    close();
  }
}

function remove(
  execSql: ExecSql,
  deletedContainers: string[],
  options: {
    containersCurrent?: boolean;
    pendingLocalWrites?: ReadonlySet<string>;
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
    hasPendingLocalWrites: (localId) =>
      options.pendingLocalWrites?.has(localId) ?? false,
    organizationId: "org-paused",
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

    expect(await remove(execSql, deletedContainers)).toBeNull();
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
      complete: true,
      deletedContainerIds: ["folder"],
      deletedLocalIds: ["synced"],
    });
    expect(deletedContainers).toEqual(["folder"]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "synced"),
    ).toBeNull();
  });
});

test("an edit still queued in an open document store blocks the removal", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "open-edit",
      snapshotEndVersion: synced,
    });
    const deletedContainers: string[] = [];

    expect(
      await remove(execSql, deletedContainers, {
        pendingLocalWrites: new Set(["open-edit"]),
      }),
    ).toBeNull();
    expect(deletedContainers).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "open-edit"),
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
      complete: false,
      deletedContainerIds: [],
      deletedLocalIds: [],
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "kept"),
    ).not.toBeNull();
  });
});

test("a document that gained an edit during removal is removed on a later pass", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "late-edit",
      snapshotEndVersion: synced,
    });
    const run = (
      containerIds: readonly string[],
      hasPendingLocalWrites: (localId: string) => boolean,
    ) =>
      removeOrganizationContentUnlessPending({
        containerIds,
        deleteContainers: (lockedExecSql, removals) =>
          sqlContainerContentsPersistence.deleteContainers(
            lockedExecSql,
            removals,
          ),
        documentProjectors: createDocumentProjectorRegistry([]),
        execSql,
        hasPendingLocalWrites,
        organizationId: "org-paused",
      });
    // The edit lands after the scan, while the containers are being removed.
    let checks = 0;
    expect(await run(["folder"], () => checks++ > 0)).toEqual({
      complete: false,
      deletedContainerIds: ["folder"],
      deletedLocalIds: [],
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "late-edit"),
    ).not.toBeNull();

    // Once it uploads, the next pass still finds it by its organization.
    expect(await run([], () => false)).toEqual({
      complete: true,
      deletedContainerIds: [],
      deletedLocalIds: ["late-edit"],
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "late-edit"),
    ).toBeNull();
  });
});

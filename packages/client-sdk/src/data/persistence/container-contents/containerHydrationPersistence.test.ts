import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

const container = {
  effectiveAccessLevel: "write" as const,
  icon: null,
  id: "container-1",
  metadataDocumentId: "metadata-1",
  name: "Remote container",
  organizationId: "organization-1",
  parentId: "parent-1",
  serverCreatedAt: "2026-01-01T00:00:00.000Z",
  serverUpdatedAt: "2026-01-02T00:00:00.000Z",
};

const record = {
  accessEpoch: 1,
  accessStateHash: "access-1",
  contentKeyBundle: null,
  documentId: "metadata-1",
  documentKekTargets: null,
  documentManifestBundle: null,
  id: container.id,
  lastCommitLsn: null,
  metadataUpdates: "",
  snapshotEndVersion: "",
};

test("a deletion fence rejects an equal absent-container hydration", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-deletion-fence",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.deleteContainer(
      execSql,
      container.id,
      { updatedAt: "2026-01-03T00:00:00.000Z" },
    );

    const stale = await sqlContainerContentsPersistence.commitHydratedContainer(
      execSql,
      {
        container,
        expectedDormantRecord: null,
        purgeDormantMetadata: false,
        record,
        remoteUpdatedAt: "2026-01-03T00:00:00.000Z",
        saveOptions: {},
      },
    );
    expect(stale).toEqual({ committed: false });
    expect(
      await sqlContainerContentsPersistence.containerExists(
        execSql,
        container.id,
      ),
    ).toBe(false);

    const restored =
      await sqlContainerContentsPersistence.commitHydratedContainer(execSql, {
        container: {
          ...container,
          serverUpdatedAt: "2026-01-04T00:00:00.000Z",
        },
        expectedDormantRecord: null,
        purgeDormantMetadata: false,
        record,
        remoteUpdatedAt: "2026-01-04T00:00:00.000Z",
        saveOptions: {},
      });
    expect(restored.committed).toBe(true);
  } finally {
    await close();
  }
});

test("dormant metadata reattaches only when the fetch observed its revocation fence", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-revocation-fetch-proof",
  );
  const revokedAt = "2026-01-03T00:00:00.000Z";
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
    );
    await sqlContainerContentsPersistence.deleteContainers(
      execSql,
      [
        {
          containerId: container.id,
          reason: "access_revoked",
          updatedAt: revokedAt,
        },
      ],
      { retainMetadataForContainerIds: [container.id] },
    );
    const dormantRecord =
      await sqlContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        container.id,
      );
    const expectedHydrationTombstone = (
      await sqlContainerContentsPersistence.loadContainerHydrationTombstones(
        execSql,
      )
    ).find((tombstone) => tombstone.containerId === container.id);
    if (!dormantRecord || !expectedHydrationTombstone) {
      throw new Error("Expected retained metadata and its revocation fence");
    }

    await expect(
      sqlContainerContentsPersistence.commitHydratedContainer(execSql, {
        container,
        expectedDormantRecord: dormantRecord,
        purgeDormantMetadata: false,
        record,
        remoteUpdatedAt: revokedAt,
        saveOptions: {},
      }),
    ).resolves.toEqual({ committed: false });
    await expect(
      sqlContainerContentsPersistence.commitHydratedContainer(execSql, {
        container,
        expectedDormantRecord: dormantRecord,
        expectedHydrationTombstone,
        purgeDormantMetadata: false,
        record,
        remoteUpdatedAt: revokedAt,
        saveOptions: {},
      }),
    ).resolves.toMatchObject({ committed: true });
  } finally {
    await close();
  }
});

test("an observed fence-only revocation permits unchanged rehydration", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-fence-only-restore",
  );
  const revokedAt = "2026-01-03T00:00:00.000Z";
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.deleteContainers(execSql, [
      {
        containerId: container.id,
        reason: "access_revoked",
        updatedAt: revokedAt,
      },
    ]);
    const expectedHydrationTombstone = (
      await sqlContainerContentsPersistence.loadContainerHydrationTombstones(
        execSql,
      )
    ).find((tombstone) => tombstone.containerId === container.id);
    if (!expectedHydrationTombstone) {
      throw new Error("Expected the access-revocation fence");
    }

    await expect(
      sqlContainerContentsPersistence.commitHydratedContainer(execSql, {
        container,
        expectedDormantRecord: null,
        expectedHydrationTombstone,
        purgeDormantMetadata: false,
        record,
        remoteUpdatedAt: revokedAt,
        saveOptions: {},
      }),
    ).resolves.toMatchObject({ committed: true });
    await expect(
      sqlContainerContentsPersistence.loadContainerHydrationTombstones(execSql),
    ).resolves.toEqual([]);
  } finally {
    await close();
  }
});

test("each deletion fence keeps its own remote timestamp", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-per-container-fence",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.deleteContainers(execSql, [
      {
        containerId: "container-earlier",
        reason: "deleted",
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
      {
        containerId: "container-later",
        reason: "deleted",
        updatedAt: "2026-01-01T00:00:03.000Z",
      },
    ]);

    const hydrate = (id: string) =>
      sqlContainerContentsPersistence.commitHydratedContainer(execSql, {
        container: {
          ...container,
          id,
          metadataDocumentId: `metadata-${id}`,
          serverUpdatedAt: "2026-01-01T00:00:02.000Z",
        },
        expectedDormantRecord: null,
        purgeDormantMetadata: false,
        record: { ...record, documentId: `metadata-${id}`, id },
        remoteUpdatedAt: "2026-01-01T00:00:02.000Z",
        saveOptions: {},
      });

    expect((await hydrate("container-earlier")).committed).toBe(true);
    expect(await hydrate("container-later")).toEqual({ committed: false });
  } finally {
    await close();
  }
});

test("cross-reason tombstones retain their newest timestamp", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-cross-reason-fence-order",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.deleteContainers(execSql, [
      {
        containerId: container.id,
        reason: "access_revoked",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ]);
    await sqlContainerContentsPersistence.deleteContainers(execSql, [
      {
        containerId: container.id,
        reason: "deleted",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    await expect(
      sqlContainerContentsPersistence.loadContainerHydrationTombstones(execSql),
    ).resolves.toEqual([
      {
        containerId: container.id,
        generation: 2,
        reason: "deleted",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ]);

    await sqlContainerContentsPersistence.deleteContainers(execSql, [
      {
        containerId: container.id,
        reason: "access_revoked",
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
    ]);
    await expect(
      sqlContainerContentsPersistence.loadContainerHydrationTombstones(execSql),
    ).resolves.toEqual([
      {
        containerId: container.id,
        generation: 3,
        reason: "deleted",
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
    ]);
  } finally {
    await close();
  }
});

test("equal-time revocations retain distinct hydration generations", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-equal-time-generation",
  );
  const revokedAt = "2026-01-03T00:00:00.000Z";
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const revoke = () =>
      sqlContainerContentsPersistence.deleteContainers(execSql, [
        {
          containerId: container.id,
          reason: "access_revoked",
          updatedAt: revokedAt,
        },
      ]);
    await revoke();
    const [firstFence] =
      await sqlContainerContentsPersistence.loadContainerHydrationTombstones(
        execSql,
      );
    if (!firstFence) throw new Error("Expected the first revocation fence");

    await revoke();
    await expect(
      sqlContainerContentsPersistence.commitHydratedContainer(execSql, {
        container,
        expectedDormantRecord: null,
        expectedHydrationTombstone: firstFence,
        purgeDormantMetadata: false,
        record,
        remoteUpdatedAt: revokedAt,
        saveOptions: {},
      }),
    ).resolves.toEqual({ committed: false });
    await expect(
      sqlContainerContentsPersistence.loadContainerHydrationTombstones(execSql),
    ).resolves.toEqual([
      {
        containerId: container.id,
        generation: firstFence.generation + 1,
        reason: "access_revoked",
        updatedAt: revokedAt,
      },
    ]);
  } finally {
    await close();
  }
});

test("a tombstone transaction refuses a newer pane's container state", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-deletion-state-guard",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
      {
        localUpdatedAt: "2026-01-02T00:00:00.000Z",
        serverTimestamps: {
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      },
    );
    const staleState =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        container.id,
      );
    if (!staleState) throw new Error("Expected stale pane state");

    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      { ...staleState.container, parentId: "newer-parent" },
      { ...record, metadataUpdates: "newer-metadata" },
      {
        localUpdatedAt: "2026-01-02T12:00:00.000Z",
        moveIntent: {
          parentContainerId: "newer-parent",
          previousParentContainerId: container.parentId,
        },
      },
    );
    await sqlContainerContentsPersistence.enqueuePendingUpdate(execSql, {
      containerId: container.id,
      partialEndVersionVector: "newer-end",
      partialStartVersionVector: "newer-start",
      sourceVersionVector: null,
      updateData: "newer-update",
    });

    await expect(
      sqlContainerContentsPersistence.deleteContainers(
        execSql,
        [
          {
            containerId: container.id,
            reason: "access_revoked",
            updatedAt: "2026-01-03T00:00:00.000Z",
          },
        ],
        {
          expectedContainers: [
            {
              containerId: container.id,
              expectedContainer: staleState.container,
            },
          ],
          retainMetadataForContainerIds: [container.id],
        },
      ),
    ).resolves.toEqual([]);
    await expect(
      sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        container.id,
      ),
    ).resolves.toMatchObject({
      container: { parentId: "newer-parent" },
      record: { metadataUpdates: "newer-metadata" },
    });
    await expect(
      sqlContainerContentsPersistence.listUnsyncedMoveIntents(execSql),
    ).resolves.toHaveLength(1);
    await expect(
      sqlContainerContentsPersistence.listPendingUpdates(execSql, container.id),
    ).resolves.toHaveLength(1);
  } finally {
    await close();
  }
});

import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createParentProjection } from "../../../test/helpers/containerFixtures";
import {
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/organizationReadModelProjectionFixtures";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/persistence/containers/containerPersistence";
import {
  containerContentsSyncLane,
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../containers";
import { loadContainerInfo } from "./containerInfo";

test("loadContainerInfo reads direct grants, organization groups, and local sync cursors", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-container-info-test",
  );
  const parent = await createParentProjection();

  try {
    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      execSql,
      containerParentSyncLane(null),
      {
        id: parent.projection.containerId,
        updatedAt: "2026-05-15T12:00:00.000Z",
      },
    );
    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      execSql,
      containerParentSyncLane(parent.projection.containerId),
      {
        id: "child-container",
        updatedAt: "2026-05-15T12:05:00.000Z",
      },
    );
    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      execSql,
      containerContentsSyncLane(parent.projection.containerId),
      {
        id: "document-1",
        updatedAt: "2026-05-15T12:10:00.000Z",
      },
    );

    const info = await loadContainerInfo({
      apiClient: {
        getContainerWriterProjection: async (containerId) => {
          expect(containerId).toBe(parent.projection.containerId);
          return parent.projection;
        },
      },
      containerId: parent.projection.containerId,
      execSql,
      loadOrganizationGroups: async () =>
        organizationReadModelSnapshot({
          currentUserId: organizationReadModelUserId,
          groupName: "Operators",
          organizationId: parent.projection.organizationId,
        }).lanes.groups.groups,
      parentId: null,
    });

    expect(info.remoteInfo?.grants).toEqual([
      {
        accessLevel: "admin",
        subjectId: parent.userId,
        subjectType: "user",
      },
    ]);
    expect(info.remoteInfo?.grantRows).toEqual([
      {
        accessLevel: "admin",
        inherited: false,
        sourceContainerId: parent.projection.containerId,
        subjectId: parent.userId,
        subjectType: "user",
      },
    ]);
    expect(info.remoteInfo?.groups.map((group) => group.name)).toEqual([
      "Operators",
    ]);
    expect(info.remoteInfo?.security).toMatchObject({
      currentContainerKeyEpoch: expect.any(Number),
      currentContainerKeyEpochId: expect.any(String),
      currentManifestHash: parent.projection.path.at(-1)?.manifestHash,
      currentManifestHistoryCount: expect.any(Number),
      currentReferencedPrincipalCount: expect.any(Number),
      pathLength: parent.projection.path.length,
    });
    expect(info.remoteInfo?.security?.path).toHaveLength(
      parent.projection.path.length,
    );
    expect(
      info.remoteInfo?.syncCursors.map(
        ({ label, laneId, laneKind, watermarkId }) => ({
          label,
          laneId,
          laneKind,
          watermarkId,
        }),
      ),
    ).toEqual([
      {
        label: "Parent Listing",
        laneId: "root",
        laneKind: "container_parent",
        watermarkId: parent.projection.containerId,
      },
      {
        label: "Child Containers",
        laneId: `parent:${parent.projection.containerId}`,
        laneKind: "container_parent",
        watermarkId: "child-container",
      },
      {
        label: "Documents",
        laneId: parent.projection.containerId,
        laneKind: "container_documents",
        watermarkId: "document-1",
      },
    ]);
    expect(info.remoteInfo?.syncCursors[0]?.savedAt).toEqual(
      expect.any(String),
    );
  } finally {
    close();
  }
});

test("loadContainerInfo includes inherited grants from ancestor containers", async () => {
  const parent = await createParentProjection();
  const childDirectGrant = {
    accessLevel: "read" as const,
    subjectId: "user-0",
    subjectType: "user" as const,
  };
  const childMaterialized = await buildMaterializedContainerCreatePlan({
    author: parent.author,
    containerId: "child-container",
    metadataDocumentId: "child-container-metadata-document",
    parentProjection: parent.projection,
    parentSecretKey: parent.secretKey,
    trustedLocalProjection: true,
  });
  const childProjection = childContainerWriterProjectionFromCreatePlan({
    materializedPlan: childMaterialized,
    parentProjection: parent.projection,
  });
  const childState = childProjection.path.at(-1)?.state;
  if (!childState || typeof childState !== "object") {
    throw new Error("Expected child projection state");
  }
  Reflect.set(childState, "directGrants", [childDirectGrant]);

  const info = await loadContainerInfo({
    apiClient: {
      getContainerWriterProjection: async (containerId) => {
        expect(containerId).toBe(childProjection.containerId);
        return childProjection;
      },
    },
    containerId: childProjection.containerId,
    loadOrganizationGroups: async () => [],
    parentId: parent.projection.containerId,
  });

  expect(info.remoteInfo?.grants).toEqual([childDirectGrant]);
  expect(info.remoteInfo?.grantRows).toEqual([
    {
      ...childDirectGrant,
      inherited: false,
      sourceContainerId: childProjection.containerId,
    },
    {
      accessLevel: "admin",
      inherited: true,
      sourceContainerId: parent.projection.containerId,
      subjectId: parent.userId,
      subjectType: "user",
    },
  ]);
});

test("loadContainerInfo returns local details without network for unsynced containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-container-info-local-only-test",
  );

  try {
    await ensureContainerTables(execSql);
    await saveContainer(execSql, {
      id: "root-container",
      effectiveAccessLevel: "admin",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    let projectionCallCount = 0;
    let readModelCallCount = 0;
    const info = await loadContainerInfo({
      apiClient: {
        getContainerWriterProjection: async () => {
          projectionCallCount += 1;
          throw new Error("Unexpected projection fetch.");
        },
      },
      containerId: "root-container",
      execSql,
      loadOrganizationGroups: async () => {
        readModelCallCount += 1;
        throw new Error("Unexpected organization read-model fetch.");
      },
      parentId: null,
      remoteInfoMode: "if-synced",
    });

    expect(info.local.createdAt).toEqual(expect.any(String));
    expect(info.local.updatedAt).toEqual(expect.any(String));
    expect(info.remoteInfo).toBeNull();
    expect(projectionCallCount).toBe(0);
    expect(readModelCallCount).toBe(0);
  } finally {
    close();
  }
});

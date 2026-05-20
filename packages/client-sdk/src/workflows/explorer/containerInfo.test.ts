import { expect, test } from "bun:test";
import { loadExplorerContainerInfo } from "@tearleads/client-sdk/workflows/explorer/containerInfo";
import { createParentProjection } from "../../../test/helpers/containerFixtures";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/persistence/containers/containerPersistence";
import {
  containerDocumentsSyncLane,
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";

test("loadExplorerContainerInfo reads direct grants, organization groups, and local sync cursors", async () => {
  const { close, execSql } = await createTestExecSql(
    "explorer-container-info-test",
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
      containerDocumentsSyncLane(parent.projection.containerId),
      {
        id: "document-1",
        updatedAt: "2026-05-15T12:10:00.000Z",
      },
    );

    const info = await loadExplorerContainerInfo({
      apiClient: {
        getContainerWriterProjection: async (containerId) => {
          expect(containerId).toBe(parent.projection.containerId);
          return parent.projection;
        },
        listOrganizationGroups: async (organizationId) => {
          expect(organizationId).toBe(parent.projection.organizationId);
          return {
            organizationId,
            groups: [
              {
                groupId: "group-1",
                organizationId,
                name: "Operators",
                createdAt: "2026-05-12T12:00:00.000Z",
                currentState: {
                  stateHash: "a".repeat(64),
                  version: 1,
                  keyEpoch: 1,
                  memberCount: 1,
                },
              },
            ],
          };
        },
      },
      containerId: parent.projection.containerId,
      execSql,
      organizationId: parent.projection.organizationId,
      parentId: null,
    });

    expect(info.remoteInfo?.grants).toEqual([
      {
        accessLevel: "admin",
        subjectId: parent.userId,
        subjectType: "user",
      },
    ]);
    expect(info.remoteInfo?.groups.map((group) => group.name)).toEqual([
      "Operators",
    ]);
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

test("loadExplorerContainerInfo returns local details without network for unsynced containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "explorer-container-info-local-only-test",
  );

  try {
    await ensureContainerTables(execSql);
    await saveContainer(execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    let projectionCallCount = 0;
    let groupCallCount = 0;
    const info = await loadExplorerContainerInfo({
      apiClient: {
        getContainerWriterProjection: async () => {
          projectionCallCount += 1;
          throw new Error("Unexpected projection fetch.");
        },
        listOrganizationGroups: async () => {
          groupCallCount += 1;
          throw new Error("Unexpected group fetch.");
        },
      },
      containerId: "root-container",
      execSql,
      organizationId: "org-1",
      parentId: null,
      remoteInfoMode: "if-synced",
    });

    expect(info.local.createdAt).toEqual(expect.any(String));
    expect(info.local.updatedAt).toEqual(expect.any(String));
    expect(info.remoteInfo).toBeNull();
    expect(projectionCallCount).toBe(0);
    expect(groupCallCount).toBe(0);
  } finally {
    close();
  }
});

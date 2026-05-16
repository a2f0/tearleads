import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import { createParentProjection } from "../../data/containers/test-helpers";
import {
  containerDocumentsSyncLane,
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import { loadExplorerContainerInfo } from "./containerInfo";

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

    expect(info.grants).toEqual([
      {
        accessLevel: "admin",
        subjectId: parent.userId,
        subjectType: "user",
      },
    ]);
    expect(info.groups.map((group) => group.name)).toEqual(["Operators"]);
    expect(
      info.syncCursors.map(({ label, laneId, laneKind, watermarkId }) => ({
        label,
        laneId,
        laneKind,
        watermarkId,
      })),
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
    expect(info.syncCursors[0]?.savedAt).toEqual(expect.any(String));
  } finally {
    close();
  }
});

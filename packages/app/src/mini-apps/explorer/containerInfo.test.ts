import { expect, test } from "bun:test";
import { createParentProjection } from "../../data/containers/test-helpers";
import { loadExplorerContainerInfo } from "./containerInfo";

test("loadExplorerContainerInfo reads direct grants and organization groups", async () => {
  const parent = await createParentProjection();
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
    organizationId: parent.projection.organizationId,
  });

  expect(info.grants).toEqual([
    {
      accessLevel: "admin",
      subjectId: parent.userId,
      subjectType: "user",
    },
  ]);
  expect(info.groups.map((group) => group.name)).toEqual(["Operators"]);
});

import { expect, test } from "bun:test";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";
import type { ContainerContentsPersistence } from "../../containerPersistence";
import { createTestContainerState } from "../containerState.testFixtures";
import type { ContainerWorkflowRuntime } from "../types";
import { containerStateHasCurrentGroupGrant } from "./groupGrantVerification";
import {
  prepareContainerStateGroupRewrap,
  shareContainerState,
  shareContainerStateWithGroup,
} from "./index";

const CONTAINER_ID = "scoped-share-container";

type ShareLoad = (input: {
  containerState: ReturnType<typeof createTestContainerState>;
  runtime: ContainerWorkflowRuntime;
  stillCurrent: () => boolean;
}) => Promise<unknown>;

const unusedPersistence = {} as ContainerContentsPersistence;
const resolveProjectionUserKey = async () => null;

/** Each share entry reads the container's projection before anything else. */
const SHARE_LOADS: Record<string, ShareLoad> = {
  "user share": (input) =>
    shareContainerState({
      ...input,
      accessLevel: "read",
      persistence: unusedPersistence,
      recipientUserId: "recipient",
      resolveProjectionUserKey,
    }),
  "group share": (input) =>
    shareContainerStateWithGroup({
      ...input,
      accessLevel: "read",
      expectedGroupName: "Readers",
      persistence: unusedPersistence,
      recipientGroupId: "readers",
      resolveProjectionUserKey,
    }),
  "group re-wrap preparation": (input) =>
    prepareContainerStateGroupRewrap({
      ...input,
      accessLevel: "read",
      groupId: "readers",
      requireExistingGrant: true,
      resolveProjectionUserKey,
    }),
  "group grant confirmation": (input) =>
    containerStateHasCurrentGroupGrant({
      ...input,
      accessLevel: "read",
      expectedContainerId: CONTAINER_ID,
      expectedGroupHead: {
        principalType: "group",
        principalId: "readers",
        version: 1,
        keyEpoch: 1,
        stateHash: "0".repeat(64),
        keyFingerprint: "readers-key",
      },
      expectedOrganizationId: "organization",
      groupId: "readers",
      resolveProjectionUserKey,
    }),
};

for (const [entry, load] of Object.entries(SHARE_LOADS)) {
  test.each(SCOPE_RETIREMENTS)(
    `a ${entry} projection read that expires after %s is not renewed or replayed`,
    async (change) => {
      const server = createExpiringApiServer({
        method: "GET",
        path: /^\/containers\/[^/]+\/writer-projection$/,
      });
      const containerState = createTestContainerState({
        id: CONTAINER_ID,
        parentId: null,
      });
      let current = true;
      try {
        const loaded = load({
          containerState,
          runtime: {
            apiClient: server.api,
          } as unknown as ContainerWorkflowRuntime,
          stillCurrent: () => current,
        });
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        expect(await loaded).toBeOneOf([null, false]);
        expect(server.requests).toEqual([
          `GET /containers/${CONTAINER_ID}/writer-projection`,
        ]);
        expect(server.renewals.count).toBe(0);
        expect(containerState.containerWriterProjection ?? null).toBeNull();
      } finally {
        server.stop();
      }
    },
  );
}

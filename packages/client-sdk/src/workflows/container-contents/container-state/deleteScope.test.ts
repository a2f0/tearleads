import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { createTestContainerState } from "./containerState.testFixtures";
import { deleteContainerState } from "./delete";
import { discardOrphanedRemoteContainer } from "./remote";
import type {
  ContainerCreateIntentSyncState,
  ContainerWorkflowRuntime,
  CreatedRemoteContainerState,
} from "./types";

test.each(SCOPE_RETIREMENTS)(
  "a container delete that expires after %s is not renewed or replayed",
  async (change) => {
    const containerState = createTestContainerState({
      id: crypto.randomUUID(),
      parentId: crypto.randomUUID(),
    });
    const containerId = containerState.container.id;
    const server = createExpiringApiServer({
      method: "DELETE",
      path: new RegExp(`^/containers/${containerId}$`),
    });
    const { close, execSql } = await createTestExecSql(
      `container-delete-scope-${change}`,
    );
    let current = true;
    try {
      await sqlContainerContentsPersistence.ensureSchema(execSql);
      containerState.container =
        await sqlContainerContentsPersistence.saveContainer(
          execSql,
          containerState.container,
          containerState.record,
        );
      const deleted = deleteContainerState({
        containerState,
        persistence: sqlContainerContentsPersistence,
        runtime: {
          apiClient: server.api,
          infra: { execSql },
        } as unknown as ContainerWorkflowRuntime,
        stillCurrent: () => current,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await deleted).toBe("remote-failed");
      expect(server.requests).toEqual([`DELETE /containers/${containerId}`]);
      expect(server.renewals.count).toBe(0);
      const [kept] =
        await sqlContainerContentsPersistence.loadContainers(execSql);
      expect(kept?.container.id).toBe(containerId);
    } finally {
      server.stop();
      close();
    }
  },
  15_000,
);

test.each(SCOPE_RETIREMENTS)(
  "an orphan discard that expires after %s is not renewed or replayed",
  async (change) => {
    const containerId = crypto.randomUUID();
    const server = createExpiringApiServer({
      method: "DELETE",
      path: new RegExp(`^/containers/${containerId}$`),
    });
    const logs: string[] = [];
    let current = true;
    try {
      const discarded = discardOrphanedRemoteContainer({
        created: {
          containerId,
          organizationId: crypto.randomUUID(),
        } as CreatedRemoteContainerState,
        isCurrent: () => current,
        state: {
          runtime: {
            apiClient: server.api,
            util: { log: (message: string) => logs.push(message) },
          },
        } as unknown as Pick<ContainerCreateIntentSyncState, "runtime">,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      await discarded;
      expect(logs).toEqual([]);
      expect(server.requests).toEqual([`DELETE /containers/${containerId}`]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
    }
  },
  15_000,
);

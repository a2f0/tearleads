import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";
import { sqlContainerContentsPersistence } from "../../../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerContentsWorkflowRuntime } from "../../runtime";
import { createTestContainerState } from "../containerState.testFixtures";
import { createSubtreePurgeScope } from "./purgeTreeScope";

test.each(SCOPE_RETIREMENTS)(
  "a purge scope's container read that expires after %s is not renewed or replayed",
  async (change) => {
    const root = createTestContainerState({
      id: crypto.randomUUID(),
      parentId: null,
    });
    const child = createTestContainerState({
      id: crypto.randomUUID(),
      parentId: root.container.id,
    });
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/containers/${child.container.id}/writer-projection$`),
    });
    const { close, execSql } = await createTestExecSql(
      `purge-scope-request-${change}`,
    );
    const logs: string[] = [];
    let current = true;
    try {
      await sqlContainerContentsPersistence.ensureSchema(execSql);
      for (const state of [root, child])
        state.container = await sqlContainerContentsPersistence.saveContainer(
          execSql,
          state.container,
          state.record,
        );
      const allowed = createSubtreePurgeScope({
        containersById: new Map([
          [root.container.id, root],
          [child.container.id, child],
        ]),
        persistence: sqlContainerContentsPersistence,
        resolveProjectionUserKey: async () => null,
        rootContainerId: root.container.id,
        runtime: {
          apiClient: server.api,
          infra: { execSql },
          util: {
            log: (message: string) => logs.push(message),
            reportSecurityIncident: async () => {},
          },
        } as unknown as ContainerContentsWorkflowRuntime,
        stillCurrent: () => current,
      }).allowsContainer(child.container.id);
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await allowed).toBe(false);
      expect(logs).toEqual([]);
      expect(server.requests).toEqual([
        `GET /containers/${child.container.id}/writer-projection`,
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      close();
    }
  },
  15_000,
);

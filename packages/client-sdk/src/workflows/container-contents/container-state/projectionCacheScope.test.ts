import { expect, test } from "bun:test";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { createTestContainerState } from "./containerState.testFixtures";
import {
  loadContainerWriterProjectionForState,
  readContainerWriterProjection,
} from "./projectionCache";
import type { ContainerWorkflowRuntime } from "./types";

// The parent projection read under a folder create, as in ensureContactsContainer.
test.each(SCOPE_RETIREMENTS)(
  "a parent projection read that expires after %s does not renew",
  async (change) => {
    const server = createExpiringApiServer({
      method: "GET",
      path: /^\/containers\/[^/]+\/writer-projection$/,
    });
    let current = true;
    try {
      const read = readContainerWriterProjection(
        server.api,
        "scoped-parent",
        () => current,
      );
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await read).toBeNull();
      expect(server.requests).toEqual([
        "GET /containers/scoped-parent/writer-projection",
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
    }
  },
);

test("a retired load leaves a current caller's projection installed", async () => {
  const containerState = createTestContainerState({
    id: "scoped-container",
    parentId: null,
  });
  const installed = {
    containerId: "scoped-container",
  } as unknown as ContainerWriterProjectionResponse;
  let current = true;
  const runtime = {
    apiClient: {
      // A current caller installs its answer while this read is retiring.
      getContainerWriterProjectionResult: async () => {
        containerState.containerWriterProjection = installed;
        current = false;
        return { ok: false, kind: "cancelled" };
      },
    },
  } as unknown as ContainerWorkflowRuntime;
  expect(
    await loadContainerWriterProjectionForState({
      containerState,
      runtime,
      stillCurrent: () => current,
    }),
  ).toBeNull();
  expect(containerState.containerWriterProjection).toBe(installed);
});

import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import {
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/organizationReadModelProjectionFixtures";
import type { InternalWorkflowRuntimeInput } from "../runtime/workflowRuntime";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";

test("a cursor whose group-name hydration failed does not cover a hint", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-presented-cursor-test",
  );
  const response = organizationReadModelSnapshot();
  let readModelRequests = 0;
  const apiClient = createMockApiClient({
    async getOrganizationReadModelResult() {
      readModelRequests += 1;
      return { data: response, ok: true };
    },
  });
  const base = createWorkflowInputFixture({
    apiClient,
    auth: {
      organizationId: organizationReadModelOrganizationId,
      userId: organizationReadModelUserId,
    },
    execSql,
  });
  // With a device key the reconcile hydrates group names; this fixture has
  // no verified organization authority, so hydration fails after the feed
  // page applied cursor N.
  let workflowInput: InternalWorkflowRuntimeInput = {
    ...base,
    crypto: {
      ...base.crypto,
      encapsulationKeyPair: {} as NonNullable<
        InternalWorkflowRuntimeInput["crypto"]["encapsulationKeyPair"]
      >,
    },
  };
  const coordinator = createOrganizationReadModelCoordinator(
    createInternalRuntimeFixture(() => workflowInput),
  );

  try {
    await expect(coordinator.reconcile()).rejects.toThrow();
    expect(readModelRequests).toBe(1);
    // Cursor N is stored, but its names never hydrated: a hint at N must
    // still reconcile so hydration is retried.
    await expect(coordinator.loadAppliedCursor()).resolves.toBeNull();

    workflowInput = base;
    await expect(coordinator.reconcile()).resolves.toMatchObject({
      readModelCursor: response.nextCursor,
    });
    await expect(coordinator.loadAppliedCursor()).resolves.toBe(
      response.nextCursor,
    );
  } finally {
    close();
  }
});

import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/data/organizationReadModelProjectionFixtures";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import { OrganizationReadModelRepository } from "../../data/persistence/organizations/organizationReadModelRepository";
import { beginCommittedReadModel } from "../../workflows/organizations/readModel/committedReadModel";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;

async function committedFixture(name: string) {
  const { close, execSql } = await createTestExecSql(name);
  await new OrganizationReadModelRepository(
    execSql,
  ).applyOrganizationReadModelResponse({
    currentUserId: userId,
    requestedCursor: null,
    response: organizationReadModelSnapshot(),
  });
  const requestedCursors: Array<string | undefined> = [];
  const apiClient = createMockApiClient({
    async getOrganizationReadModelResult(_organizationId, cursor) {
      requestedCursors.push(cursor);
      return {
        data: organizationReadModelGroupsDelta({
          cursor: "cursor-feed",
          groupName: "Operators",
        }),
        ok: true,
      };
    },
  });
  const workflowInput = createWorkflowInputFixture({
    apiClient,
    auth: { organizationId, userId },
    execSql,
  });
  const coordinator = createOrganizationReadModelCoordinator(
    createInternalRuntimeFixture(() => workflowInput),
  );
  const scope = { execSql, organizationId, userId };
  return { close, coordinator, execSql, requestedCursors, scope };
}

test("an own mutation's delta presents without a feed request", async () => {
  const f = await committedFixture("committed-read-model-own-delta-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    expect(lease.heldCursor).toBe("cursor-1");
    const delta = organizationReadModelGroupsDelta({
      cursor: "cursor-2",
      groupName: "Operators",
    });
    lease.settle(delta);

    const presented = await f.coordinator.reconcileAfterOwnMutation(
      organizationId,
      delta,
    );

    expect(f.requestedCursors).toEqual([]);
    expect(presented?.readModelCursor).toBe("cursor-2");
    await expect(f.coordinator.loadAppliedCursor()).resolves.toBe("cursor-2");
    // The offer is taken once: a second post-commit read uses the feed.
    await f.coordinator.reconcileAfterOwnMutation(organizationId, delta);
    expect(f.requestedCursors).toEqual(["cursor-2"]);
  } finally {
    f.close();
  }
});

test("a delta for a cursor the projection moved past falls back to the feed", async () => {
  const f = await committedFixture("committed-read-model-moved-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    await new OrganizationReadModelRepository(
      f.execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: "cursor-1",
      response: organizationReadModelGroupsDelta({
        cursor: "cursor-2",
        groupName: "Operators",
      }),
    });
    const delta = organizationReadModelGroupsDelta({
      cursor: "cursor-3",
      groupName: "Operators",
    });
    lease.settle(delta);

    await expect(
      f.coordinator.applyCommittedReadModel(organizationId, delta),
    ).resolves.toBeUndefined();
    const presented = await f.coordinator.reconcileAfterOwnMutation(
      organizationId,
      delta,
    );

    expect(f.requestedCursors).toEqual(["cursor-2"]);
    expect(presented?.readModelCursor).toBe("cursor-feed");
  } finally {
    f.close();
  }
});

test("a hint's cursor check waits for an own mutation and applies its delta", async () => {
  const f = await committedFixture("committed-read-model-hint-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    let checked = false;
    const applied = f.coordinator.loadAppliedCursor().then((cursor) => {
      checked = true;
      return cursor;
    });
    await Promise.resolve();
    expect(checked).toBe(false);

    lease.settle(
      organizationReadModelGroupsDelta({
        cursor: "cursor-2",
        groupName: "Operators",
      }),
    );

    await expect(applied).resolves.toBe("cursor-2");
    expect(f.requestedCursors).toEqual([]);
  } finally {
    f.close();
  }
});

test("a mutation without a delta settles its lease and changes nothing", async () => {
  const f = await committedFixture("committed-read-model-no-delta-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    lease.settle(undefined);
    lease.settle(
      organizationReadModelGroupsDelta({
        cursor: "cursor-2",
        groupName: "Operators",
      }),
    );

    await expect(f.coordinator.loadAppliedCursor()).resolves.toBeNull();
    await f.coordinator.reconcileAfterOwnMutation(organizationId, undefined);
    expect(f.requestedCursors).toEqual(["cursor-1"]);
  } finally {
    f.close();
  }
});

import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import invariant from "invariant";
import {
  organizationReadModelCursorAt,
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
import { loadLocalOrganizationDirectoryAndGroups } from "../../workflows/organizations";
import {
  beginCommittedReadModel,
  takeCommittedReadModelOffer,
} from "../../workflows/organizations/readModel/committedReadModel";
import { runOrganizationPresentationMutation } from "../../workflows/organizations/readModel/organizationPresentationAccessState";
import { presentOrganizationReadModelPass } from "./organizationReadModelPresentation";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";
import { activeOrganizationDataRuntime } from "./organizationWorkflowRuntime";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;
const cursorAt = (position: number) => organizationReadModelCursorAt(position);

async function committedFixture(name: string, feedGate?: Promise<void>) {
  const { close, execSql } = await createTestExecSql(name);
  await new OrganizationReadModelRepository(
    execSql,
  ).applyOrganizationReadModelResponse({
    currentUserId: userId,
    requestedCursor: null,
    response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
  });
  const requestedCursors: Array<string | undefined> = [];
  const apiClient = createMockApiClient({
    async getOrganizationReadModelResult(_organizationId, cursor) {
      requestedCursors.push(cursor);
      await feedGate;
      return {
        data: organizationReadModelGroupsDelta({
          cursor: cursorAt(9),
          groupName: "Operators",
        }),
        ok: true,
      };
    },
  });
  let workflowInput = createWorkflowInputFixture({
    apiClient,
    auth: { organizationId, userId },
    execSql,
  });
  let sessionGeneration = 0;
  const runtime = {
    ...createInternalRuntimeFixture(() => workflowInput),
    get sessionGeneration() {
      return sessionGeneration;
    },
  };
  const coordinator = createOrganizationReadModelCoordinator(runtime);
  const scope = {
    domainScope: workflowInput.state.domainScope,
    execSql,
    organizationId,
    sessionGeneration: 0,
    userId,
  };
  // A logout and a login of the same identity keep the domain scope.
  const advanceSession = () => {
    sessionGeneration += 1;
    return { ...scope, sessionGeneration };
  };
  // A logout or identity switch hands the runtime a new domain scope.
  const switchDomainScope = () => {
    workflowInput = createWorkflowInputFixture({
      apiClient,
      auth: { organizationId, userId },
      execSql,
    });
    return { ...scope, domainScope: workflowInput.state.domainScope };
  };
  return {
    advanceSession,
    close,
    coordinator,
    execSql,
    requestedCursors,
    runtime,
    scope,
    switchDomainScope,
  };
}

test("an own mutation's delta presents without a feed request", async () => {
  const f = await committedFixture("committed-read-model-own-delta-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    expect(lease.heldCursor).toBe(cursorAt(1));
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);

    const presented = await f.coordinator.reconcileAfterOwnMutation(
      organizationId,
      delta,
    );

    expect(f.requestedCursors).toEqual([]);
    expect(presented?.readModelCursor).toBe(cursorAt(2));
    await expect(f.coordinator.loadAppliedCursor()).resolves.toBe(cursorAt(2));
    // The offer is taken once: a second post-commit read uses the feed.
    await f.coordinator.reconcileAfterOwnMutation(organizationId, delta);
    expect(f.requestedCursors).toEqual([cursorAt(2)]);
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
      requestedCursor: cursorAt(1),
      response: organizationReadModelGroupsDelta({
        cursor: cursorAt(2),
        groupName: "Operators",
      }),
    });
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(3),
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

    expect(f.requestedCursors).toEqual([cursorAt(2)]);
    expect(presented?.readModelCursor).toBe(cursorAt(9));
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
        cursor: cursorAt(2),
        groupName: "Operators",
      }),
    );

    await expect(applied).resolves.toBe(cursorAt(2));
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
        cursor: cursorAt(2),
        groupName: "Operators",
      }),
    );

    await expect(f.coordinator.loadAppliedCursor()).resolves.toBeNull();
    await f.coordinator.reconcileAfterOwnMutation(organizationId, undefined);
    expect(f.requestedCursors).toEqual([cursorAt(1)]);
  } finally {
    f.close();
  }
});

test("a delta that fails to apply resolves undefined, leaving the feed read", async () => {
  const f = await committedFixture("committed-read-model-failure-test");
  const lease = await beginCommittedReadModel(f.scope);
  const delta = organizationReadModelGroupsDelta({
    cursor: cursorAt(2),
    groupName: "Operators",
  });
  lease.settle(delta);
  f.close();

  await expect(
    f.coordinator.applyCommittedReadModel(organizationId, delta),
  ).resolves.toBeUndefined();
  expect(f.requestedCursors).toEqual([]);
});

test("a hint check overtaken by a scope switch applies nothing", async () => {
  const f = await committedFixture("committed-read-model-switch-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const checked = f.coordinator.loadAppliedCursor();
    await Promise.resolve();
    const nextScope = f.switchDomainScope();
    const nextLease = await beginCommittedReadModel(nextScope);
    const nextDelta = organizationReadModelGroupsDelta({
      cursor: cursorAt(3),
      groupName: "Operators",
    });
    nextLease.settle(nextDelta);
    lease.settle(
      organizationReadModelGroupsDelta({
        cursor: cursorAt(2),
        groupName: "Operators",
      }),
    );
    await checked;

    // The overtaken check neither applied its own scope's delta nor drained
    // the new scope's.
    expect(takeCommittedReadModelOffer(nextScope, nextDelta)).toEqual({
      delta: nextDelta,
      heldCursor: cursorAt(1),
    });

    await expect(
      new OrganizationReadModelRepository(
        f.execSql,
      ).loadOrganizationReadModelCursor(organizationId),
    ).resolves.toBe(cursorAt(1));
    expect(f.requestedCursors).toEqual([]);
  } finally {
    f.close();
  }
});

test("a feed refresh during a delta's apply reads after it", async () => {
  const f = await committedFixture("committed-read-model-refresh-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    const applying = f.coordinator.applyCommittedReadModel(
      organizationId,
      delta,
    );
    // Let the apply register before the refresh arrives; no I/O runs here.
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    const refreshed = f.coordinator.reconcile();

    await expect(applying).resolves.toMatchObject({
      readModelCursor: cursorAt(2),
    });
    await expect(refreshed).resolves.toMatchObject({
      readModelCursor: cursorAt(9),
    });
    expect(f.requestedCursors).toEqual([cursorAt(2)]);
  } finally {
    f.close();
  }
});

test("a mutation's fallback read stays with the scope that committed", async () => {
  const f = await committedFixture("committed-read-model-fallback-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(1),
      groupName: "Operators",
    });
    lease.settle(delta);
    const settled = f.coordinator.reconcileAfterOwnMutation(
      organizationId,
      delta,
    );
    f.switchDomainScope();

    await expect(settled).resolves.toBeUndefined();
    expect(f.requestedCursors).toEqual([]);
  } finally {
    f.close();
  }
});

test("a delta from before a logout does not apply in the next session", async () => {
  const f = await committedFixture("committed-read-model-session-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    const nextScope = f.advanceSession();
    const nextLease = await beginCommittedReadModel(nextScope);

    await expect(
      f.coordinator.applyCommittedReadModel(organizationId, delta),
    ).resolves.toBeUndefined();
    const checked = f.coordinator.loadAppliedCursor();
    nextLease.settle(undefined);
    await checked;
    await expect(
      new OrganizationReadModelRepository(
        f.execSql,
      ).loadOrganizationReadModelCursor(organizationId),
    ).resolves.toBe(cursorAt(1));
  } finally {
    f.close();
  }
});

test("a refresh that waited out a delta does not read for a new scope", async () => {
  const f = await committedFixture("committed-read-model-refresh-switch-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    const applying = f.coordinator.applyCommittedReadModel(
      organizationId,
      delta,
    );
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    const refreshed = f.coordinator.reconcile();
    f.switchDomainScope();

    await applying;
    await expect(refreshed).resolves.toBeNull();
    expect(f.requestedCursors).toEqual([]);
  } finally {
    f.close();
  }
});

test("a delta blocked behind another write applies nothing after a logout", async () => {
  const f = await committedFixture("committed-read-model-blocked-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    let release = () => {};
    const blocked = runOrganizationPresentationMutation(
      f.execSql,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const applying = f.coordinator.applyCommittedReadModel(
      organizationId,
      delta,
    );
    // Let the apply reach the serialized write before the logout.
    for (let turn = 0; turn < 50; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    f.advanceSession();
    release();
    await blocked;

    expect(await applying).toBeFalsy();
    await expect(
      new OrganizationReadModelRepository(
        f.execSql,
      ).loadOrganizationReadModelCursor(organizationId),
    ).resolves.toBe(cursorAt(1));
  } finally {
    f.close();
  }
});

test("a fallback that waited out a feed read does not read for a new session", async () => {
  let openFeed = () => {};
  const f = await committedFixture(
    "committed-read-model-fallback-wait-test",
    new Promise<void>((resolve) => {
      openFeed = resolve;
    }),
  );
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(1),
      groupName: "Operators",
    });
    lease.settle(delta);
    const feed = f.coordinator.reconcile();
    const settled = f.coordinator.reconcileAfterOwnMutation(
      organizationId,
      delta,
    );
    for (let turn = 0; turn < 50; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    f.advanceSession();
    openFeed();
    await feed;

    await expect(settled).resolves.toBeUndefined();
    expect(f.requestedCursors).toEqual([cursorAt(1)]);
  } finally {
    f.close();
  }
});

test("a refresh that waited out a delta does not read after a relogin", async () => {
  const f = await committedFixture("committed-read-model-refresh-relogin-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    const applying = f.coordinator.applyCommittedReadModel(
      organizationId,
      delta,
    );
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    const refreshed = f.coordinator.reconcile();
    f.advanceSession();

    await applying;
    await expect(refreshed).resolves.toBeNull();
    expect(f.requestedCursors).toEqual([]);
  } finally {
    f.close();
  }
});

test("a transition during presentation publishes nothing", async () => {
  const f = await committedFixture("committed-read-model-presentation-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    const runtime = f.runtime;
    const active = activeOrganizationDataRuntime(runtime, organizationId);
    invariant(active, "expected an active organization runtime");
    let checks = 0;
    // Current through the pass and the access step, then overtaken.
    const presented = await presentOrganizationReadModelPass(
      runtime,
      active,
      () =>
        loadLocalOrganizationDirectoryAndGroups({
          currentUserId: userId,
          execSql: f.execSql,
          organizationId,
        }),
      () => {
        checks += 1;
        return checks <= 2;
      },
    );

    expect(presented).toBeNull();
    expect(checks).toBe(3);
  } finally {
    f.close();
  }
});

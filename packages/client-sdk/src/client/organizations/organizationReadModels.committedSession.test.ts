import { expect, test } from "bun:test";
import invariant from "invariant";
import { committedFixture } from "../../../test/helpers/client/committedReadModelCoordinatorFixture";
import {
  organizationReadModelCursorAt,
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelUserId,
} from "../../../test/helpers/data/organizationReadModelProjectionFixtures";
import { OrganizationReadModelRepository } from "../../data/persistence/organizations/organizationReadModelRepository";
import { loadLocalOrganizationDirectoryAndGroups } from "../../workflows/organizations";
import {
  beginCommittedReadModel,
  claimCommittedReadModelOffer,
} from "../../workflows/organizations/readModel/committedReadModel";
import { runOrganizationPresentationMutation } from "../../workflows/organizations/readModel/organizationPresentationAccessState";
import { presentOrganizationReadModelPass } from "./organizationReadModelPresentation";
import { activeOrganizationDataRuntime } from "./organizationWorkflowRuntime";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;
const cursorAt = (position: number) => organizationReadModelCursorAt(position);

test("a hint check overtaken by a scope switch applies nothing", async () => {
  const f = await committedFixture("committed-read-model-switch-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const checked = f.coordinator.loadAppliedCursor(2n);
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
    let unclaimed: unknown;
    await claimCommittedReadModelOffer(nextScope, nextDelta, async (offer) => {
      unclaimed = offer;
      return null;
    });
    expect(unclaimed).toEqual({ delta: nextDelta, heldCursor: cursorAt(1) });

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
    const checked = f.coordinator.loadAppliedCursor(2n);
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

test("a hint check started before a relogin claims nothing of the next session", async () => {
  const f = await committedFixture("committed-read-model-hint-relogin-test");
  try {
    const nextScope = { ...f.scope, sessionGeneration: 1 };
    const nextLease = await beginCommittedReadModel(nextScope);
    // The check starts in session 0; the relogin lands during its first read.
    const checked = f.coordinator.loadAppliedCursor(2n);
    f.advanceSession();
    const nextDelta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    nextLease.settle(nextDelta);

    await expect(checked).resolves.toBeNull();
    let unclaimed: unknown;
    await claimCommittedReadModelOffer(nextScope, nextDelta, async (offer) => {
      unclaimed = offer;
      return null;
    });
    expect(unclaimed).toEqual({ delta: nextDelta, heldCursor: cursorAt(1) });
  } finally {
    f.close();
  }
});

import { expect, spyOn, test } from "bun:test";
import { committedFixture } from "../../../test/helpers/client/committedReadModelCoordinatorFixture";
import {
  organizationReadModelCursorAt,
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelUserId,
} from "../../../test/helpers/data/organizationReadModelProjectionFixtures";
import { OrganizationReadModelRepository } from "../../data/persistence/organizations/organizationReadModelRepository";
import { beginCommittedReadModel } from "../../workflows/organizations/readModel/committedReadModel";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;
const cursorAt = (position: number) => organizationReadModelCursorAt(position);

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
    await expect(f.coordinator.loadAppliedCursor(2n)).resolves.toBe(
      cursorAt(2),
    );
    // The offer applies once: a second claim of it shares that apply.
    await expect(
      f.coordinator.reconcileAfterOwnMutation(organizationId, delta),
    ).resolves.toBe(presented);
    expect(f.requestedCursors).toEqual([]);
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
    const applied = f.coordinator.loadAppliedCursor(2n).then((cursor) => {
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

    await expect(f.coordinator.loadAppliedCursor(2n)).resolves.toBeNull();
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

test("a hint that claims the delta first shares its apply with the mutation", async () => {
  const f = await committedFixture("committed-read-model-hint-first-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const checked = f.coordinator.loadAppliedCursor(2n);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    await expect(checked).resolves.toBe(cursorAt(2));

    await expect(
      f.coordinator.reconcileAfterOwnMutation(organizationId, delta),
    ).resolves.toMatchObject({ readModelCursor: cursorAt(2) });
    expect(f.requestedCursors).toEqual([]);
  } finally {
    f.close();
  }
});

test("a hint the presentation already covers waits for no mutation", async () => {
  const f = await committedFixture("committed-read-model-covered-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    // A mutation sent from the same cursor stalls; it could commit cursor 2,
    // but the hint is already covered once the first mutation presents it.
    await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    await f.coordinator.reconcileAfterOwnMutation(organizationId, delta);

    const checked = await Promise.race([
      f.coordinator.loadAppliedCursor(2n),
      new Promise<"waiting">((resolve) =>
        setTimeout(resolve, 1_000, "waiting"),
      ),
    ]);

    expect(checked).toBe(cursorAt(2));
  } finally {
    f.close();
  }
});

test("distinct offers apply in turn, so a stale one is not consumed unapplied", async () => {
  const f = await committedFixture("committed-read-model-distinct-test");
  try {
    const first = await beginCommittedReadModel(f.scope);
    const second = await beginCommittedReadModel(f.scope);
    const firstDelta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    const secondDelta = organizationReadModelGroupsDelta({
      cursor: cursorAt(3),
      groupName: "Auditors",
    });
    first.settle(firstDelta);
    second.settle(secondDelta);

    const applied = f.coordinator.applyCommittedReadModel(
      organizationId,
      firstDelta,
    );
    const stale = f.coordinator.applyCommittedReadModel(
      organizationId,
      secondDelta,
    );

    await expect(applied).resolves.toMatchObject({
      readModelCursor: cursorAt(2),
    });
    // Both were sent from cursor 1, which the projection no longer holds.
    await expect(stale).resolves.toBeUndefined();
  } finally {
    f.close();
  }
});

test("an earlier apply a feed pass replaced is not reused", async () => {
  const f = await committedFixture("committed-read-model-replaced-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    await expect(f.coordinator.loadAppliedCursor(2n)).resolves.toBe(
      cursorAt(2),
    );
    await f.coordinator.reconcile();

    // The hint applied the delta, then a feed pass moved past it: the
    // mutation's own read takes the current projection, not cursor 2.
    await expect(
      f.coordinator.reconcileAfterOwnMutation(organizationId, delta),
    ).resolves.toMatchObject({ readModelCursor: cursorAt(9) });
  } finally {
    f.close();
  }
});

test("a failed check after a delta applied is only a missed delta", async () => {
  const f = await committedFixture("committed-read-model-check-failure-test");
  try {
    const lease = await beginCommittedReadModel(f.scope);
    const delta = organizationReadModelGroupsDelta({
      cursor: cursorAt(2),
      groupName: "Operators",
    });
    lease.settle(delta);
    const check = spyOn(
      OrganizationReadModelRepository.prototype,
      "loadAppliedOrganizationReadModelCursor",
    ).mockRejectedValue(new Error("disk I/O error"));
    try {
      await expect(
        f.coordinator.applyCommittedReadModel(organizationId, delta),
      ).resolves.toBeUndefined();
    } finally {
      check.mockRestore();
    }
    // The delta itself applied; only the check after it failed.
    await expect(
      new OrganizationReadModelRepository(
        f.execSql,
      ).loadOrganizationReadModelCursor(organizationId),
    ).resolves.toBe(cursorAt(2));
  } finally {
    f.close();
  }
});

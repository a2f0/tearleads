import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelCursorAt,
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../../test/helpers/data/organizationReadModelProjectionFixtures";
import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import {
  applyCommittedOrganizationReadModel,
  awaitCommittedReadModelOffers,
  beginCommittedReadModel,
  claimCommittedReadModelOffer,
} from "./committedReadModel";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;
const cursorAt = (position: number) => organizationReadModelCursorAt(position);

function delta(cursor: string) {
  return organizationReadModelGroupsDelta({ cursor, groupName: "Operators" });
}

test("a cold projection holds no cursor, so its mutation earns no delta", async () => {
  const { close, execSql } = await createTestExecSql("committed-cold-test");
  try {
    const lease = await beginCommittedReadModel({
      domainScope: {},
      sessionGeneration: 0,
      execSql,
      organizationId,
      userId,
    });
    expect(lease.heldCursor).toBeUndefined();
    lease.settle(delta(cursorAt(2)));
    await expect(
      awaitCommittedReadModelOffers(
        {
          domainScope: {},
          sessionGeneration: 0,
          execSql,
          organizationId,
          userId,
        },
        2n,
      ),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("each offer applies once, its outcome shared by every claimant", async () => {
  const { close, execSql } = await createTestExecSql("committed-take-test");
  const scope = {
    domainScope: {},
    sessionGeneration: 0,
    execSql,
    organizationId,
    userId,
  };
  try {
    await new OrganizationReadModelRepository(
      execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
    });
    const own = await beginCommittedReadModel(scope);
    const other = await beginCommittedReadModel(scope);
    const ownDelta = delta(cursorAt(2));
    const otherDelta = delta(cursorAt(3));
    own.settle(ownDelta);
    other.settle(otherDelta);

    const applied: unknown[] = [];
    const apply = async (offer: unknown) => {
      applied.push(offer);
      return null;
    };
    const first = claimCommittedReadModelOffer(scope, ownDelta, apply);
    const second = claimCommittedReadModelOffer(scope, ownDelta, apply);

    expect(second).toBe(first);
    await expect(first).resolves.toBeNull();
    expect(applied).toEqual([{ delta: ownDelta, heldCursor: cursorAt(1) }]);
    await expect(awaitCommittedReadModelOffers(scope, 3n)).resolves.toEqual([
      { delta: otherDelta, heldCursor: cursorAt(1) },
    ]);
    await claimCommittedReadModelOffer(scope, otherDelta, apply);
    await expect(awaitCommittedReadModelOffers(scope, 3n)).resolves.toEqual([]);
    expect(
      claimCommittedReadModelOffer(scope, delta(cursorAt(4)), apply),
    ).toBeUndefined();
  } finally {
    close();
  }
});

test("a hint check stops waiting for a mutation that never settles", async () => {
  const { close, execSql } = await createTestExecSql("committed-wait-test");
  const scope = {
    domainScope: {},
    sessionGeneration: 0,
    execSql,
    organizationId,
    userId,
  };
  try {
    await new OrganizationReadModelRepository(
      execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
    });
    await beginCommittedReadModel(scope);
    await expect(awaitCommittedReadModelOffers(scope, 2n, 5)).resolves.toEqual(
      [],
    );
  } finally {
    close();
  }
});

test("a committed delta applies only over the cursor its mutation sent", async () => {
  const { close, execSql } = await createTestExecSql("committed-apply-test");
  const input = { currentUserId: userId, execSql, organizationId };
  try {
    await new OrganizationReadModelRepository(
      execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
    });

    for (const [requestedCursor, nextCursor] of [
      [cursorAt(0), cursorAt(2)],
      // A delta that does not advance past the sent cursor stands for nothing.
      [cursorAt(1), cursorAt(1)],
      [cursorAt(1), cursorAt(0)],
      [cursorAt(1), "not-a-cursor"],
    ] as const) {
      await expect(
        applyCommittedOrganizationReadModel({
          ...input,
          requestedCursor,
          response: delta(nextCursor),
        }),
      ).resolves.toBeUndefined();
    }
    const applied = await applyCommittedOrganizationReadModel({
      ...input,
      requestedCursor: cursorAt(1),
      response: delta(cursorAt(2)),
    });

    expect(applied?.readModelCursor).toBe(cursorAt(2));
    await expect(
      new OrganizationReadModelRepository(
        execSql,
      ).loadOrganizationReadModelCursor(organizationId),
    ).resolves.toBe(cursorAt(2));
  } finally {
    close();
  }
});

test("an unreadable projection begins a lease without a cursor", async () => {
  const { close, execSql } = await createTestExecSql("committed-closed-test");
  close();
  const lease = await beginCommittedReadModel({
    domainScope: {},
    sessionGeneration: 0,
    execSql,
    organizationId,
    userId,
  });
  expect(lease.heldCursor).toBeUndefined();
});

test("a newer session retires the requester's older offers", async () => {
  const { close, execSql } = await createTestExecSql("committed-retire-test");
  const scope = {
    domainScope: {},
    execSql,
    organizationId,
    sessionGeneration: 0,
    userId,
  };
  try {
    await new OrganizationReadModelRepository(
      execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
    });
    (await beginCommittedReadModel(scope)).settle(delta(cursorAt(2)));
    (await beginCommittedReadModel({ ...scope, sessionGeneration: 1 })).settle(
      undefined,
    );

    await expect(awaitCommittedReadModelOffers(scope, 2n)).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("a refused commit guard leaves the projection unapplied", async () => {
  const { close, execSql } = await createTestExecSql("committed-guard-test");
  const repository = new OrganizationReadModelRepository(execSql);
  try {
    await repository.applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
    });

    await expect(
      repository.applyOrganizationReadModelResponse({
        canCommit: () => false,
        currentUserId: userId,
        requestedCursor: cursorAt(1),
        response: delta(cursorAt(2)),
      }),
    ).resolves.toBe("stale");
    await expect(
      repository.loadOrganizationReadModelCursor(organizationId),
    ).resolves.toBe(cursorAt(1));
  } finally {
    close();
  }
});

test("a hint waits only for mutations that could be its commit", async () => {
  const { close, execSql } = await createTestExecSql("committed-bound-test");
  const scope = {
    domainScope: {},
    sessionGeneration: 0,
    execSql,
    organizationId,
    userId,
  };
  const within = <T>(promise: Promise<T>, ms: number) =>
    Promise.race([
      promise.then(() => "settled" as const),
      new Promise<"waiting">((resolve) => setTimeout(resolve, ms, "waiting")),
    ]);
  try {
    await new OrganizationReadModelRepository(
      execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
    });
    // A share held at cursor 1 stamps one cursor: it can commit only 2.
    const share = await beginCommittedReadModel(scope, 1);

    await expect(
      within(awaitCommittedReadModelOffers(scope, 1n), 1_000),
    ).resolves.toBe("settled");
    await expect(
      within(awaitCommittedReadModelOffers(scope, 3n), 1_000),
    ).resolves.toBe("settled");
    const covering = awaitCommittedReadModelOffers(scope, 2n);
    await expect(within(covering, 50)).resolves.toBe("waiting");
    share.settle(delta(cursorAt(2)));
    await expect(covering).resolves.toEqual([
      { delta: delta(cursorAt(2)), heldCursor: cursorAt(1) },
    ]);
  } finally {
    close();
  }
});

test("a hint stops waiting once a settled offer covers it", async () => {
  const { close, execSql } = await createTestExecSql("committed-cover-test");
  const scope = {
    domainScope: {},
    sessionGeneration: 0,
    execSql,
    organizationId,
    userId,
  };
  try {
    await new OrganizationReadModelRepository(
      execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
    });
    const covering = await beginCommittedReadModel(scope);
    await beginCommittedReadModel(scope);
    const waited = awaitCommittedReadModelOffers(scope, 2n);
    covering.settle(delta(cursorAt(2)));

    const outcome = await Promise.race([
      waited,
      new Promise<"waiting">((resolve) =>
        setTimeout(resolve, 1_000, "waiting"),
      ),
    ]);
    expect(outcome).toEqual([
      { delta: delta(cursorAt(2)), heldCursor: cursorAt(1) },
    ]);
  } finally {
    close();
  }
});

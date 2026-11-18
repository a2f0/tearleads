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
  beginCommittedReadModel,
  takeCommittedReadModelOffer,
  takeCommittedReadModelOffers,
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
      execSql,
      organizationId,
      userId,
    });
    expect(lease.heldCursor).toBeUndefined();
    lease.settle(delta(cursorAt(2)));
    await expect(
      takeCommittedReadModelOffers({
        domainScope: {},
        execSql,
        organizationId,
        userId,
      }),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("offers are taken once, by their own delta or by a hint check", async () => {
  const { close, execSql } = await createTestExecSql("committed-take-test");
  const scope = { domainScope: {}, execSql, organizationId, userId };
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

    expect(takeCommittedReadModelOffer(scope, ownDelta)).toEqual({
      delta: ownDelta,
      heldCursor: cursorAt(1),
    });
    expect(takeCommittedReadModelOffer(scope, ownDelta)).toBeUndefined();
    await expect(takeCommittedReadModelOffers(scope)).resolves.toEqual([
      { delta: otherDelta, heldCursor: cursorAt(1) },
    ]);
    await expect(takeCommittedReadModelOffers(scope)).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("a hint check stops waiting for a mutation that never settles", async () => {
  const { close, execSql } = await createTestExecSql("committed-wait-test");
  const scope = { domainScope: {}, execSql, organizationId, userId };
  try {
    await new OrganizationReadModelRepository(
      execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
    });
    await beginCommittedReadModel(scope);
    await expect(takeCommittedReadModelOffers(scope, 5)).resolves.toEqual([]);
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
    execSql,
    organizationId,
    userId,
  });
  expect(lease.heldCursor).toBeUndefined();
});

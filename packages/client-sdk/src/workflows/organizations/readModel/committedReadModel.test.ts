import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../../test/helpers/data/organizationReadModelProjectionFixtures";
import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import {
  beginCommittedReadModel,
  takeCommittedReadModelOffer,
  takeCommittedReadModelOffers,
} from "./committedReadModel";
import { applyCommittedOrganizationReadModel } from "./readModelProjection";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;

function delta(cursor: string) {
  return organizationReadModelGroupsDelta({ cursor, groupName: "Operators" });
}

test("a cold projection holds no cursor, so its mutation earns no delta", async () => {
  const { close, execSql } = await createTestExecSql("committed-cold-test");
  try {
    const lease = await beginCommittedReadModel({
      execSql,
      organizationId,
      userId,
    });
    expect(lease.heldCursor).toBeUndefined();
    lease.settle(delta("cursor-2"));
    await expect(
      takeCommittedReadModelOffers({ execSql, organizationId, userId }),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("offers are taken once, by their own delta or by a hint check", async () => {
  const { close, execSql } = await createTestExecSql("committed-take-test");
  const scope = { execSql, organizationId, userId };
  try {
    await new OrganizationReadModelRepository(
      execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot(),
    });
    const own = await beginCommittedReadModel(scope);
    const other = await beginCommittedReadModel(scope);
    const ownDelta = delta("cursor-2");
    const otherDelta = delta("cursor-3");
    own.settle(ownDelta);
    other.settle(otherDelta);

    expect(takeCommittedReadModelOffer(scope, ownDelta)).toEqual({
      delta: ownDelta,
      heldCursor: "cursor-1",
    });
    expect(takeCommittedReadModelOffer(scope, ownDelta)).toBeUndefined();
    await expect(takeCommittedReadModelOffers(scope)).resolves.toEqual([
      { delta: otherDelta, heldCursor: "cursor-1" },
    ]);
    await expect(takeCommittedReadModelOffers(scope)).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("a hint check stops waiting for a mutation that never settles", async () => {
  const { close, execSql } = await createTestExecSql("committed-wait-test");
  const scope = { execSql, organizationId, userId };
  try {
    await new OrganizationReadModelRepository(
      execSql,
    ).applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot(),
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
      response: organizationReadModelSnapshot(),
    });

    await expect(
      applyCommittedOrganizationReadModel({
        ...input,
        requestedCursor: "cursor-0",
        response: delta("cursor-2"),
      }),
    ).resolves.toBeUndefined();
    const applied = await applyCommittedOrganizationReadModel({
      ...input,
      requestedCursor: "cursor-1",
      response: delta("cursor-2"),
    });

    expect(applied?.readModelCursor).toBe("cursor-2");
    await expect(
      new OrganizationReadModelRepository(
        execSql,
      ).loadOrganizationReadModelCursor(organizationId),
    ).resolves.toBe("cursor-2");
  } finally {
    close();
  }
});

test("an unreadable projection begins a lease without a cursor", async () => {
  const { close, execSql } = await createTestExecSql("committed-closed-test");
  close();
  const lease = await beginCommittedReadModel({
    execSql,
    organizationId,
    userId,
  });
  expect(lease.heldCursor).toBeUndefined();
});

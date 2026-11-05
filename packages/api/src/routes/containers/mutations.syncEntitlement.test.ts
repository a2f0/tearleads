import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containers,
  organizationBilling,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { buildCreateRequest } from "../../../test/helpers/containerCreateRequests";
import {
  createChild,
  postMutation,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import {
  requestSingleContainerParentLane as listContainersForUser,
  readContainerParentLanePage as readLanePage,
} from "../../../test/helpers/containerParentLaneQuery";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import {
  setTestOrganizationBillingExpiredTrial,
  setTestOrganizationBillingLocal,
} from "../../../test/helpers/organizationBilling";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";

test("POST /containers is rejected with 402 when the organization cannot sync", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId));
  invariant(ownerRow, "expected registered owner row");
  await setTestOrganizationBillingLocal(ownerRow.organizationId);

  const containerId = crypto.randomUUID();
  const request = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });
  expect(response.status).toBe(402);
  await expect(response.json()).resolves.toEqual({
    error: "Organization sync is not active",
    organizationId: ownerRow.organizationId,
    reason: "billing_inactive",
  });

  // The mutation rolled back: no new container was persisted.
  const containerRows = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, containerId));
  expect(containerRows).toHaveLength(0);
});

test("POST /containers rejects an active organization user without a sync seat", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId));
  invariant(ownerRow, "expected registered owner row");
  await setTestOrganizationBillingLocal(ownerRow.organizationId);
  await db
    .update(organizationBilling)
    .set({
      currentPeriodEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      currentPeriodStartsAt: new Date("2098-12-01T00:00:00.000Z"),
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, ownerRow.organizationId));

  const containerId = crypto.randomUUID();
  const request = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });
  expect(response.status).toBe(402);
  await expect(response.json()).resolves.toEqual({
    error: "No sync seat is assigned to this user",
    organizationId: ownerRow.organizationId,
    reason: "sync_seat_unassigned",
  });

  const containerRows = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, containerId));
  expect(containerRows).toHaveLength(0);
});

test("batch reads work with sync disabled", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const beforeResponse = await listContainersForUser({
    parentId: owner.rootContainerId,
    token: owner.token,
  });
  const before = await readLanePage(beforeResponse);
  expect(
    before.items.map((container: { id: string }) => container.id),
  ).toContain(child.containerId);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId));
  invariant(ownerRow, "expected registered owner row");
  await setTestOrganizationBillingLocal(ownerRow.organizationId);

  const afterResponse = await listContainersForUser({
    parentId: owner.rootContainerId,
    token: owner.token,
  });
  expect(afterResponse.status).toBe(200);
  const after = await readLanePage(afterResponse);
  expect(
    after.items.map((container: { id: string }) => container.id),
  ).toContain(child.containerId);
});

test("batch reads work before expired-trial disablement", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId));
  invariant(ownerRow, "expected registered owner row");
  // Still `trialing` in the row, but past `trialEndsAt`: reads stay available
  // while writes/syncs use the billing gate.
  await setTestOrganizationBillingExpiredTrial(ownerRow.organizationId);

  const afterResponse = await listContainersForUser({
    parentId: owner.rootContainerId,
    token: owner.token,
  });
  expect(afterResponse.status).toBe(200);
  const after = await readLanePage(afterResponse);
  expect(
    after.items.map((container: { id: string }) => container.id),
  ).toContain(child.containerId);
});

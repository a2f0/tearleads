import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { lockOrganizationReadModelHeadForUpdateInTransaction } from "../../src/workflows/organizations/readModelChanges";
import { assertOrganizationUsersHaveNoCurrentDirectContainerGrants } from "../../src/workflows/organizations/roster";
import { authenticate } from "./authenticate";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "./keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "./organizationMembership";
import { registerUser } from "./registerUser";

export async function runDirectGrantRosterRemovalRace(): Promise<void> {
  const owner = createTestUser();
  const member = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(member);
  await authenticate(member);
  const root = await bootstrapRoot(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const grantRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient: member,
    signer: owner,
  });

  let markRemovalHeld: () => void = () => undefined;
  const removalHeld = new Promise<void>((resolve) => {
    markRemovalHeld = resolve;
  });
  let releaseRemoval: () => void = () => undefined;
  const removalRelease = new Promise<void>((resolve) => {
    releaseRemoval = resolve;
  });

  const removal = db.transaction(async (tx) => {
    const headLocked =
      await lockOrganizationReadModelHeadForUpdateInTransaction(
        tx,
        organizationId,
      );
    expect(headLocked).toBe(true);
    await assertOrganizationUsersHaveNoCurrentDirectContainerGrants({
      executor: tx,
      organizationId,
      userIds: [member.userId],
    });
    const now = new Date();
    await tx
      .update(organizationRosterEntries)
      .set({
        disabledAt: now,
        disabledByUserId: owner.userId,
        status: "disabled",
        updatedAt: now,
      })
      .where(
        and(
          eq(organizationRosterEntries.organizationId, organizationId),
          eq(organizationRosterEntries.userId, member.userId),
        ),
      );
    markRemovalHeld();
    await removalRelease;
  });

  await removalHeld;
  let grantSettled = false;
  const grant = Promise.resolve(
    routeApp.request(`/containers/${root.kekState.containerId}/share`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    }),
  ).then((response) => {
    grantSettled = true;
    return response;
  });

  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(grantSettled).toBe(false);

  releaseRemoval();
  await removal;
  const response = await grant;
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "Container user grants require active organization members",
  });

  const [head] = await db
    .select({ manifestHash: accessManifestHeads.manifestHash })
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(accessManifestHeads.objectId, root.kekState.containerId),
      ),
    )
    .limit(1);
  expect(head?.manifestHash).toBe(root.bundle.manifestHash);
}

import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { authenticate } from "./authenticate";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "./keyingWriterProjectionKit";
import { removeMemberGroupUser } from "./organizationMember";
import { getDefaultOrganizationId } from "./organizationMembership";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "./postgresConcurrency";
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

  const rosterLock = await holdPostgresLock(async (tx) => {
    const [entry] = await tx
      .select({ userId: organizationRosterEntries.userId })
      .from(organizationRosterEntries)
      .where(
        and(
          eq(organizationRosterEntries.organizationId, organizationId),
          eq(organizationRosterEntries.userId, member.userId),
        ),
      )
      .limit(1)
      .for("update");
    expect(entry?.userId).toBe(member.userId);
  });

  const removal = removeMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  });
  let grant: Promise<Response> | undefined;
  let synchronizationError: unknown;
  try {
    // The signed Members-policy route now holds the organization mutation lock
    // and is blocked only on its final roster update.
    await waitForPostgresLockWait({
      blockerPid: rosterLock.backendPid,
      queryFragment: "organization_roster_entries",
    });
    grant = Promise.resolve(
      routeApp.request(`/containers/${root.kekState.containerId}/share`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(grantRequest),
      }),
    );

    // Observing the grant route waiting on the same organization head proves
    // both production mutations overlap in the intended serialization order.
    await waitForPostgresLockWait({
      blockerPid: rosterLock.backendPid,
      queryFragment: "organization_read_model_heads",
    });
  } catch (error) {
    synchronizationError = error;
  } finally {
    await rosterLock.release();
  }

  if (synchronizationError) {
    await Promise.allSettled([removal, ...(grant ? [grant] : [])]);
    throw synchronizationError;
  }
  await removal;
  if (!grant) {
    throw new Error("Expected the container grant request to start");
  }
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

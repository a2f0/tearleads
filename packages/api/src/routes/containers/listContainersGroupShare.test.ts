import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers, organizations, users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

const SIGNED_AT = "2026-05-05T00:00:00.000Z";

async function addUserToAdminGroup(input: {
  actor: ReturnType<typeof createTestUser>;
  memberUserId: string;
  organizationId: string;
}): Promise<string> {
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  invariant(organization, "expected organization row");

  const currentState = await getCurrentPrincipalState(
    "group",
    organization.adminGroupId,
    db,
  );
  invariant(currentState, "expected current Admins state");
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.adminGroupId,
    db,
  );

  const nextProjection = [
    ...currentProjection.map((projectionMember) => ({
      memberPrincipalType: projectionMember.memberPrincipalType,
      memberPrincipalId: projectionMember.memberPrincipalId,
      role: projectionMember.role,
    })),
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: input.memberUserId,
      role: "member" as const,
    },
  ];

  const groupKem = generateKemSeedAndKeyPair();
  const signedState = await signPrincipalStateBundle({
    principalType: "group",
    principalId: organization.adminGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    members: nextProjection.map((projectionMember) => ({
      principalType: projectionMember.memberPrincipalType,
      principalId: projectionMember.memberPrincipalId,
    })),
    projection: nextProjection,
    payloadCiphertext: JSON.stringify({ members: nextProjection }),
    signedAt: SIGNED_AT,
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });

  const response = await routeApp.request(
    `/principals/group/${organization.adminGroupId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.actor.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: signedState.projection,
      }),
    },
  );
  expect(response.status).toBe(200);
  return organization.adminGroupId;
}

test("GET /containers surfaces the owner root container after a peer joins the admin group", async () => {
  const owner = createTestUser();
  const peer = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(peer);
  await authenticate(peer);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner user row");

  // Before joining: peer only sees their own root container.
  const beforeResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: { Authorization: `Bearer ${peer.token}` },
  });
  expect(beforeResponse.status).toBe(200);
  const beforeBody = await beforeResponse.json();
  expect(
    beforeBody.items.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);

  await addUserToAdminGroup({
    actor: owner,
    memberUserId: peer.userId,
    organizationId: ownerRow.organizationId,
  });

  // After joining the admin group, the owner's root container (granted to the
  // admin group at registration) should be reachable for the peer.
  const afterResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: { Authorization: `Bearer ${peer.token}` },
  });
  expect(afterResponse.status).toBe(200);
  const afterBody = await afterResponse.json();
  expect(
    afterBody.items.map((container: { id: string }) => container.id),
  ).toContain(owner.rootContainerId);
});

test("GET /containers root lane resume hides a newly shared root behind a stale watermark", async () => {
  const owner = createTestUser();
  const peer = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(peer);
  await authenticate(peer);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner user row");

  // A warm-cache peer keeps a root-lane watermark from a prior sync. Joining a
  // group does not bump the owner root container's updatedAt, so the resume
  // query (updatedAt, id) > (watermark) filters the newly granted root out.
  const [ownerRootRow] = await db
    .select({ updatedAt: containers.updatedAt })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  invariant(ownerRootRow, "expected owner root container row");
  const staleWatermarkUpdatedAt = new Date(
    new Date(ownerRootRow.updatedAt).getTime() + 1,
  ).toISOString();

  await addUserToAdminGroup({
    actor: owner,
    memberUserId: peer.userId,
    organizationId: ownerRow.organizationId,
  });

  // Without a watermark, the peer sees the shared root (proven above).
  const freshResponse = await routeApp.request("/containers?parentId=null", {
    method: "GET",
    headers: { Authorization: `Bearer ${peer.token}` },
  });
  expect(freshResponse.status).toBe(200);
  const freshBody = await freshResponse.json();
  expect(
    freshBody.items.map((container: { id: string }) => container.id),
  ).toContain(owner.rootContainerId);

  // Resuming from the stale watermark, the refresh re-probe returns nothing new
  // and the share never appears — the real-app symptom.
  const resumeResponse = await routeApp.request(
    `/containers?parentId=null&watermarkUpdatedAt=${encodeURIComponent(
      staleWatermarkUpdatedAt,
    )}&watermarkId=${encodeURIComponent(crypto.randomUUID())}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${peer.token}` },
    },
  );
  expect(resumeResponse.status).toBe(200);
  const resumeBody = await resumeResponse.json();
  expect(
    resumeBody.items.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);
});

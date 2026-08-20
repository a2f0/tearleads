import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizations, users } from "@tearleads/api-shared/schema";
import type { createTestUser, TestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../src/access/read/principalStateStore";
import { createPrincipalMemberEnvelopes } from "./principalMemberEnvelopes";
import { submitOrganizationGroupPolicyCommit } from "./principalPolicy";
import { signPrincipalStateBundle } from "./principalState";

export async function getDefaultOrganizationId(
  userId: string,
): Promise<string> {
  const [user] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected registered user");
  return user.organizationId;
}

/**
 * Re-add a registered user to the organization's Members group through the
 * real signed policy PUT — the same access-gain transition production runs,
 * so tests exercising gain-side effects (roster sync, tombstone pruning) go
 * through the actual route wiring.
 */
export async function addOrganizationMember(input: {
  actor: ReturnType<typeof createTestUser>;
  member: TestUser;
  organizationId: string;
}): Promise<void> {
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  const currentState = await getCurrentPrincipalState(
    "group",
    organization.memberGroupId,
    db,
  );
  invariant(currentState, "expected current Members state");
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.memberGroupId,
    db,
  );
  if (
    currentProjection.some((member) => member.userId === input.member.userId)
  ) {
    return;
  }
  const nextProjection = [
    ...currentProjection.map((projectionMember) => ({
      userId: projectionMember.userId,
      role: projectionMember.role,
    })),
    {
      userId: input.member.userId,
      role: "member" as const,
    },
  ];
  const principalKem = generateKemSeedAndKeyPair();
  const members = nextProjection.map((projectionMember) => ({
    userId: projectionMember.userId,
  }));
  const projection = nextProjection;
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });
  const signedState = await signPrincipalStateBundle({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    externalAuthority: null,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify(members)),
    ),
    signedAt: new Date("2026-04-08T16:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
    memberEnvelopes,
  });

  const response = await submitOrganizationGroupPolicyCommit({
    actor: input.actor,
    groupId: organization.memberGroupId,
    groupPolicy: signedState,
    organizationId: input.organizationId,
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

export async function joinOrg(
  organizationId: string,
  actor: ReturnType<typeof createTestUser>,
  member: TestUser,
): Promise<void> {
  return addOrganizationMember({ actor, member, organizationId });
}

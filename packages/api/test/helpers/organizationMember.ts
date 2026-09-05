import { db } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  toFingerprint,
} from "@tearleads/crypto";
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

interface MemberGroupUsersMutationInput {
  actor: TestUser;
  memberUserIds: readonly string[];
  organizationId: string;
}

async function updateMemberGroupUsers(
  input: MemberGroupUsersMutationInput,
  operation: "add" | "remove",
): Promise<void> {
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
  invariant(currentState, "expected current member group state");

  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.memberGroupId,
    db,
  );
  const existingProjection = currentProjection.map((member) => ({
    userId: member.userId,
    role: member.role,
  }));
  const projection = normalizePrincipalProjectionMembers(
    operation === "add"
      ? [
          ...existingProjection,
          ...input.memberUserIds.map((userId) => ({
            userId,
            role: "member" as const,
          })),
        ]
      : existingProjection.filter(
          (member) => !input.memberUserIds.includes(member.userId),
        ),
  );
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({ members: projection, name: "Members" }),
    ),
  );
  const principalKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });
  const state = await signPrincipalStateBundle({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    memberEnvelopes,
    payloadCiphertext,
    signedAt: new Date("2026-05-12T12:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });

  const response = await submitOrganizationGroupPolicyCommit({
    actor: input.actor,
    groupId: organization.memberGroupId,
    groupPolicy: state,
    organizationId: input.organizationId,
  });
  if (!response.ok) {
    throw new Error(
      `Failed to update organization membership: ${response.status} ${await response.text()}`,
    );
  }
}

export function addMemberGroupUser(
  input: Omit<MemberGroupUsersMutationInput, "memberUserIds"> & {
    memberUserId: string;
  },
): Promise<void> {
  return updateMemberGroupUsers(
    { ...input, memberUserIds: [input.memberUserId] },
    "add",
  );
}

export function addMemberGroupUsers(
  input: MemberGroupUsersMutationInput,
): Promise<void> {
  return updateMemberGroupUsers(input, "add");
}

export function removeMemberGroupUser(
  input: Omit<MemberGroupUsersMutationInput, "memberUserIds"> & {
    memberUserId: string;
  },
): Promise<void> {
  return updateMemberGroupUsers(
    { ...input, memberUserIds: [input.memberUserId] },
    "remove",
  );
}

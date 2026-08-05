import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import type { createTestUser, TestUser } from "@tearleads/bob-and-alice";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../src/access/read/principalStateStore";
import { routeApp } from "../../src/routeApp";
import { buildRootContainerRekeyMutation } from "./containerRekey";
import { bootstrapRoot } from "./keyingWriterProjectionKit";
import { addOrganizationMember } from "./organizationMembership";
import {
  signPrincipalStateBundle,
  toPrincipalStateExternalAuthority,
} from "./principalState";

const SIGNED_AT = "2026-05-05T00:00:00.000Z";

export async function getCurrentOrganizationAdminAuthority(
  organizationId: string,
) {
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  const state = await getCurrentPrincipalState(
    "group",
    organization.adminGroupId,
    db,
  );
  invariant(state, "expected current Admins state");
  return toPrincipalStateExternalAuthority(state);
}

/**
 * Adds a user to the organization's Admins group, seeding Members first.
 *
 * Members-then-Admins is the order production uses (`prepareRosterImport`), and
 * since group nesting was removed the server requires it: Admins no longer
 * contains Members transitively, so an Admins-only user would be an admin on no
 * roster and on nobody's invoice, which the policy PUT now rejects.
 */
async function ensureOrganizationMember(input: {
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
  const currentMembers = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.memberGroupId,
    db,
  );
  if (currentMembers.some((member) => member.userId === input.member.userId)) {
    return;
  }
  await addOrganizationMember(input);
}

export async function prepareUserForAdminGroup(input: {
  actor: ReturnType<typeof createTestUser>;
  member: TestUser;
  organizationId: string;
}) {
  await ensureOrganizationMember(input);

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
      userId: projectionMember.userId,
      role: projectionMember.role,
    })),
    {
      userId: input.member.userId,
      role: "admin" as const,
    },
  ];

  const groupKem = generateKemSeedAndKeyPair();
  const recipients = [input.actor, input.member];
  const memberEnvelopes = await Promise.all(
    recipients.map(async (recipient) => {
      const [wrappedGroupKey] = await wrapDekForRecipients(groupKem.secretKey, [
        recipient.kem.publicKey,
      ]);
      invariant(wrappedGroupKey, "expected principal member envelope");
      return {
        userId: recipient.userId,
        memberKeyFingerprint: await toFingerprint(recipient.kem.publicKey),
        kemCipherText: bytesToBase64(wrappedGroupKey.kemCipherText),
        wrappedKey: bytesToBase64(wrappedGroupKey.wrappedKey),
      };
    }),
  );
  const signedState = await signPrincipalStateBundle({
    principalType: "group",
    principalId: organization.adminGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    members: nextProjection.map((projectionMember) => ({
      userId: projectionMember.userId,
    })),
    projection: nextProjection,
    payloadCiphertext: JSON.stringify({ members: nextProjection }),
    signedAt: SIGNED_AT,
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
    memberEnvelopes,
  });
  const stateHash = await computePrincipalStateHash(signedState.state);
  const root = await bootstrapRoot(input.actor);
  const currentPolicy = root.principalPolicies.find(
    (policy) => policy.principalId === organization.adminGroupId,
  );
  invariant(currentPolicy, "expected current Admins policy");
  const nextState = {
    ...signedState.state,
    stateHash,
    createdAt: signedState.state.signedAt,
  };
  const nextPolicy = makeVerifiedPrincipalPolicy({
    principalType: nextState.principalType,
    principalId: nextState.principalId,
    version: nextState.version,
    keyEpoch: nextState.keyEpoch,
    stateHash,
    state: nextState,
    projection: signedState.projection,
    history: [
      { state: currentPolicy.state, projection: currentPolicy.projection },
      { state: nextState, projection: signedState.projection },
    ],
    checkpoint: {
      principalType: nextState.principalType,
      principalId: nextState.principalId,
      version: nextState.version,
      stateHash,
    },
  });
  const rootRekey = await buildRootContainerRekeyMutation({
    previous: root,
    replacementPrincipalPolicy: nextPolicy,
    signer: input.actor,
  });

  return {
    adminGroupId: organization.adminGroupId,
    request: {
      state: signedState.state,
      encryptedPayload: signedState.encryptedPayload,
      projection: signedState.projection,
      memberEnvelopes: signedState.memberEnvelopes,
      containerMutations: [rootRekey.request],
    },
  };
}

export async function addUserToAdminGroup(input: {
  actor: ReturnType<typeof createTestUser>;
  member: TestUser;
  organizationId: string;
}): Promise<string> {
  const prepared = await prepareUserForAdminGroup(input);

  const response = await routeApp.request(
    `/principals/group/${prepared.adminGroupId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.actor.token}`,
      },
      body: JSON.stringify(prepared.request),
    },
  );
  expect(response.status).toBe(200);
  return prepared.adminGroupId;
}

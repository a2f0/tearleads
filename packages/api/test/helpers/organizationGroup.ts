import { db } from "@tearleads/api-shared/postgres";
import { organizations, users } from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { getCurrentPrincipalState } from "../../src/access/read/principalStateStore";
import { routeApp } from "../../src/routeApp";
import { createPrincipalMemberEnvelopes } from "./principalMemberEnvelopes";
import {
  buildOrganizationGroupDeletionRequest,
  withOrganizationGroupDirectoryPolicy,
} from "./principalPolicy";
import {
  signPrincipalStateBundle,
  toPrincipalStateExternalAuthority,
} from "./principalState";

export async function createGroupRequest(input: {
  actor: TestUser;
  /** Extra users to seed into the new group's initial policy. */
  additionalMembers?: readonly TestUser[] | undefined;
  groupId: string;
  includeActorAsAdmin?: boolean | undefined;
  name: string;
}) {
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      organizationId: organizations.id,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.defaultOrganizationId))
    .where(eq(users.id, input.actor.userId))
    .limit(1);
  invariant(organization, "expected actor organization");
  const principalKem = generateKemSeedAndKeyPair();
  const includeActor = input.includeActorAsAdmin ?? true;
  const projection = normalizePrincipalProjectionMembers([
    ...(includeActor
      ? [
          {
            userId: input.actor.userId,
            role: "admin" as const,
          },
        ]
      : []),
    ...(input.additionalMembers ?? []).map((member) => ({
      userId: member.userId,
      role: "member" as const,
    })),
  ]);
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });
  let externalAuthority = null;
  if (!includeActor) {
    const adminState = await getCurrentPrincipalState(
      "group",
      organization.adminGroupId,
      db,
    );
    invariant(adminState, "expected current Admins state");
    externalAuthority = toPrincipalStateExternalAuthority(adminState);
  }
  const state = await signPrincipalStateBundle({
    principalType: "group",
    principalId: input.groupId,
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    grants: [],
    memberEnvelopes,
    payloadCiphertext,
    externalAuthority,
    signedAt: new Date("2026-05-12T12:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });

  return withOrganizationGroupDirectoryPolicy({
    actor: input.actor,
    organizationId: organization.organizationId,
    request: {
      groupId: input.groupId,
      name: input.name,
      initialGroupPolicy: {
        state: state.state,
        encryptedPayload: state.encryptedPayload,
        projection: state.projection,
        grants: state.grants,
        memberEnvelopes,
      },
    },
  });
}

export async function deleteGroupRequest(input: {
  actor: TestUser;
  groupId: string;
  organizationId: string;
}) {
  return routeApp.request(
    `/organizations/${input.organizationId}/groups/${input.groupId}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.actor.token}`,
      },
      body: JSON.stringify(await buildOrganizationGroupDeletionRequest(input)),
    },
  );
}

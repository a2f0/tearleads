import { db } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import { normalizePrincipalProjectionMembers } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../src/access/read/principalStateStore";
import { upsertActiveOrganizationRosterEntries } from "../../src/workflows/organizations/roster";
import {
  signPrincipalStateBundle,
  storePrincipalState,
} from "./principalState";

export async function addMemberGroupUser(input: {
  actor: TestUser;
  memberUserId: string;
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
  invariant(currentState, "expected current member group state");

  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.memberGroupId,
    db,
  );
  const projection = normalizePrincipalProjectionMembers([
    ...currentProjection.map((member) => ({
      memberPrincipalType: member.memberPrincipalType,
      memberPrincipalId: member.memberPrincipalId,
      role: member.role,
    })),
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: input.memberUserId,
      role: "member" as const,
    },
  ]);
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
  const state = await signPrincipalStateBundle({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch,
    encapsulationPublicKey: currentState.encapsulationPublicKey,
    keyFingerprint: currentState.keyFingerprint,
    members: projection.map((member) => ({
      principalType: member.memberPrincipalType,
      principalId: member.memberPrincipalId,
    })),
    projection,
    payloadCiphertext,
    signedAt: new Date("2026-05-12T12:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });

  await storePrincipalState(state, db);
  await upsertActiveOrganizationRosterEntries({
    executor: db,
    organizationId: input.organizationId,
    userIds: [input.memberUserId],
  });
}

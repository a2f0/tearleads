import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { groups, organizations, users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isCommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { loadAuthoritativeOrganizationGroupHeads } from "../../workflows/organizations/organizationGroupDirectoryValidation";
import { getPrincipalPolicyForStateWithExecutor } from "../../workflows/principals/getCurrentPrincipalPolicy";

async function defaultOrganization(userId: string) {
  const [row] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
      organizationId: organizations.id,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.defaultOrganizationId))
    .where(eq(users.id, userId))
    .limit(1);
  invariant(row, "expected default organization");
  return row;
}

async function prepareCompoundPolicy(input: {
  actor: ReturnType<typeof createTestUser>;
  commitNextGroupHead: boolean;
}) {
  const organization = await defaultOrganization(input.actor.userId);
  const groupState = await getCurrentPrincipalState(
    "group",
    organization.memberGroupId,
    db,
  );
  const organizationState = await getCurrentPrincipalState(
    "organization",
    organization.organizationId,
    db,
  );
  invariant(groupState, "expected Members policy");
  invariant(organizationState, "expected organization policy");
  const groupBundle = await getPrincipalPolicyForStateWithExecutor(
    db,
    groupState,
  );
  const organizationBundle = await getPrincipalPolicyForStateWithExecutor(
    db,
    organizationState,
  );
  const groupPolicy = await signPrincipalStateBundle({
    principalType: "group",
    principalId: organization.memberGroupId,
    version: groupState.version + 1,
    prevStateHash: groupState.stateHash,
    keyEpoch: groupState.keyEpoch,
    encapsulationPublicKey: groupState.encapsulationPublicKey,
    keyFingerprint: groupState.keyFingerprint,
    members: groupBundle.currentProjection.map(({ userId }) => ({ userId })),
    projection: groupBundle.currentProjection,
    grants: groupBundle.currentGrants,
    externalAuthority: null,
    payloadCiphertext: groupBundle.currentPayload.ciphertext,
    signedAt: "2026-08-11T12:00:00.000Z",
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
    memberEnvelopes: groupBundle.currentMemberEnvelopes.envelopes,
  });
  const nextGroupHead = {
    principalType: "group" as const,
    principalId: organization.memberGroupId,
    version: groupPolicy.state.version,
    keyEpoch: groupPolicy.state.keyEpoch,
    stateHash: await computePrincipalStateHash(groupPolicy.state),
    keyFingerprint: groupPolicy.state.keyFingerprint,
  };
  const currentHeads = await loadAuthoritativeOrganizationGroupHeads({
    executor: db,
    organizationId: organization.organizationId,
  });
  const groupHeads = input.commitNextGroupHead
    ? currentHeads.map((head) =>
        head.principalId === nextGroupHead.principalId ? nextGroupHead : head,
      )
    : currentHeads;
  const organizationKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: organizationKem.secretKey,
      projection: organizationBundle.currentProjection,
    });
  const organizationPolicy = await signPrincipalStateBundle({
    principalType: "organization",
    principalId: organization.organizationId,
    version: organizationState.version + 1,
    prevStateHash: organizationState.stateHash,
    keyEpoch: organizationState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
    keyFingerprint: await toFingerprint(organizationKem.publicKey),
    members: stateMembers,
    projection: organizationBundle.currentProjection,
    grants: [],
    externalAuthority: null,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(
        JSON.stringify({
          version: 2,
          organizationId: organization.organizationId,
          adminGroupId: organization.adminGroupId,
          memberGroupId: organization.memberGroupId,
          groupHeads,
        }),
      ),
    ),
    signedAt: "2026-08-11T12:00:01.000Z",
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
    memberEnvelopes,
  });
  return {
    groupPolicy,
    nextGroupHead,
    organization,
    organizationPolicy,
    previousGroupStateHash: groupState.stateHash,
  };
}

async function commitPrepared(
  actor: ReturnType<typeof createTestUser>,
  prepared: Awaited<ReturnType<typeof prepareCompoundPolicy>>,
) {
  return routeApp.request(
    `/organizations/${prepared.organization.organizationId}/groups/${prepared.organization.memberGroupId}/policy-commit`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        groupPolicy: prepared.groupPolicy,
        organizationPolicy: prepared.organizationPolicy,
      }),
    },
  );
}

test("group policy commits atomically advance the signed organization directory", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const prepared = await prepareCompoundPolicy({
    actor,
    commitNextGroupHead: true,
  });

  const response = await commitPrepared(actor, prepared);

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(
    isCommitOrganizationGroupPolicyResponse(body),
    "expected compound policy response",
  );
  expect(body.groupPolicy.currentState.stateHash).toBe(
    prepared.nextGroupHead.stateHash,
  );
  expect(body.organizationPolicy.currentState.version).toBe(
    prepared.organizationPolicy.state.version,
  );
});

test("a stateless group row blocks organization policy commits", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const prepared = await prepareCompoundPolicy({
    actor,
    commitNextGroupHead: true,
  });
  await db.insert(groups).values({
    id: crypto.randomUUID(),
    name: "Injected without policy",
    organizationId: prepared.organization.organizationId,
  });

  const response = await commitPrepared(actor, prepared);

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Organization group policy is missing",
  });
  expect(
    await getCurrentPrincipalState(
      "group",
      prepared.organization.memberGroupId,
      db,
    ),
  ).toMatchObject({ stateHash: prepared.previousGroupStateHash });
});

test("a stale signed directory rejects and rolls back its paired group successor", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const prepared = await prepareCompoundPolicy({
    actor,
    commitNextGroupHead: false,
  });

  const response = await commitPrepared(actor, prepared);

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Organization authority descriptor must commit every current group head",
  });
  const storedGroup = await getCurrentPrincipalState(
    "group",
    prepared.organization.memberGroupId,
    db,
  );
  expect(storedGroup?.stateHash).toBe(prepared.previousGroupStateHash);
});

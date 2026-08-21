import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizations, users } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  type PrincipalContainerGrant,
  type PrincipalProjectionMember,
  type PrincipalStateExternalAuthority,
  toFingerprint,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import { submitOrganizationGroupPolicyCommit } from "../../../test/helpers/principalPolicy";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { getPrincipalPolicyForStateWithExecutor } from "../../workflows/principals/getCurrentPrincipalPolicy";

async function getDefaultOrganizationId(userId: string): Promise<string> {
  const [user] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  invariant(user, "expected registered user");
  return user.organizationId;
}

async function createSignedSuccessor(input: {
  readonly actor: ReturnType<typeof createTestUser>;
  readonly currentState: {
    readonly keyEpoch: number;
    readonly stateHash: string;
    readonly version: number;
  };
  readonly externalAuthority?: PrincipalStateExternalAuthority | null;
  readonly grants?: readonly PrincipalContainerGrant[];
  readonly payloadCiphertext?: string;
  readonly principalId: string;
  readonly principalType: "group" | "organization";
  readonly projection: PrincipalProjectionMember[];
}) {
  const principalKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection: input.projection,
    });
  return signPrincipalStateBundle({
    principalType: input.principalType,
    principalId: input.principalId,
    version: input.currentState.version + 1,
    prevStateHash: input.currentState.stateHash,
    keyEpoch: input.currentState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection: input.projection,
    grants: [...(input.grants ?? [])],
    externalAuthority: input.externalAuthority ?? null,
    payloadCiphertext:
      input.payloadCiphertext ??
      bytesToBase64(new TextEncoder().encode(JSON.stringify(stateMembers))),
    signedAt: new Date("2026-04-08T16:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
    memberEnvelopes,
  });
}

async function prepareOrganizationPolicySuccessor(input: {
  readonly actor: ReturnType<typeof createTestUser>;
  readonly grants?: readonly PrincipalContainerGrant[];
  readonly projection?: PrincipalProjectionMember[];
}) {
  const organizationId = await getDefaultOrganizationId(input.actor.userId);
  const currentState = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  invariant(currentState, "expected organization policy");
  const currentPolicy = await getPrincipalPolicyForStateWithExecutor(
    db,
    currentState,
  );
  const projection =
    input.projection ??
    currentPolicy.currentProjection.map((member) => ({ ...member }));
  const successor = await createSignedSuccessor({
    actor: input.actor,
    currentState,
    ...(input.grants === undefined ? {} : { grants: input.grants }),
    payloadCiphertext: currentPolicy.currentPayload.ciphertext,
    principalId: organizationId,
    principalType: "organization",
    projection,
  });
  return { currentState, organizationId, successor };
}

function putOrganizationPolicy(input: {
  readonly actor: ReturnType<typeof createTestUser>;
  readonly organizationId: string;
  readonly successor: Awaited<ReturnType<typeof createSignedSuccessor>>;
}) {
  return routeApp.request(
    `/principals/organization/${input.organizationId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.actor.token}`,
      },
      body: JSON.stringify(input.successor),
    },
  );
}

async function postGroup(
  actor: ReturnType<typeof createTestUser>,
  organizationId: string,
  body: unknown,
): Promise<Response> {
  return routeApp.request(`/organizations/${organizationId}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${actor.token}`,
    },
    body: JSON.stringify(body),
  });
}

test("PUT policy rejects non-admin roles in the reserved Admins group", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization");
  const currentState = await getCurrentPrincipalState(
    "group",
    organization.adminGroupId,
    db,
  );
  invariant(currentState, "expected Admins policy");
  const projection: PrincipalProjectionMember[] = [
    {
      userId: actor.userId,
      role: "member",
    },
  ];
  const successor = await createSignedSuccessor({
    actor,
    currentState,
    principalType: "group",
    principalId: organization.adminGroupId,
    projection,
  });

  const response = await submitOrganizationGroupPolicyCommit({
    actor,
    groupId: organization.adminGroupId,
    groupPolicy: successor,
    organizationId,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Reserved Admins policy must contain only direct admin users",
  });
});

test("PUT policy rejects an organization descriptor with the wrong reserved groups", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const currentState = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  invariant(currentState, "expected organization policy");
  const projection = (
    await listCurrentPrincipalProjectionMembers(
      "organization",
      organizationId,
      db,
    )
  ).map((member) => ({
    userId: member.userId,
    role: member.role,
  }));
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        organizationId,
        adminGroupId: crypto.randomUUID(),
        memberGroupId: crypto.randomUUID(),
      }),
    ),
  );
  const successor = await createSignedSuccessor({
    actor,
    currentState,
    principalType: "organization",
    principalId: organizationId,
    projection,
    payloadCiphertext,
  });

  const response = await routeApp.request(
    `/principals/organization/${organizationId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(successor),
    },
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Organization authority descriptor scope is invalid",
  });
});

test("PUT policy rejects organization container grants and preserves its head", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const prepared = await prepareOrganizationPolicySuccessor({
    actor,
    grants: [{ accessLevel: "admin", containerId: crypto.randomUUID() }],
  });

  const response = await putOrganizationPolicy({ actor, ...prepared });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Organization policy cannot contain container grants",
  });
  expect(
    await getCurrentPrincipalState("organization", prepared.organizationId, db),
  ).toMatchObject({ stateHash: prepared.currentState.stateHash });
});

test("PUT policy rejects projections that diverge from Admins and preserves its head", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const prepared = await prepareOrganizationPolicySuccessor({
    actor,
    projection: [{ role: "member", userId: actor.userId }],
  });

  const response = await putOrganizationPolicy({ actor, ...prepared });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error:
      "Organization policy projection must match the current Admins policy",
  });
  expect(
    await getCurrentPrincipalState("organization", prepared.organizationId, db),
  ).toMatchObject({ stateHash: prepared.currentState.stateHash });
});

test("PUT policy rejects a stale signed Admins authority head", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization");
  const adminState = await getCurrentPrincipalState(
    "group",
    organization.adminGroupId,
    db,
  );
  invariant(adminState, "expected Admins policy");
  const staleAuthority: PrincipalStateExternalAuthority = {
    principalType: "group",
    principalId: adminState.principalId,
    version: adminState.version,
    keyEpoch: adminState.keyEpoch,
    stateHash: adminState.stateHash,
    keyFingerprint: adminState.keyFingerprint,
  };
  const groupId = crypto.randomUUID();
  const createResponse = await postGroup(
    actor,
    organizationId,
    await createGroupRequest({
      actor,
      groupId,
      includeActorAsAdmin: false,
      name: "Externally administered",
    }),
  );
  expect(createResponse.status).toBe(200);
  const groupState = await getCurrentPrincipalState("group", groupId, db);
  invariant(groupState, "expected group policy");
  const successor = await createSignedSuccessor({
    actor,
    currentState: groupState,
    externalAuthority: staleAuthority,
    principalId: groupId,
    principalType: "group",
    projection: [],
  });

  const replacement = createTestUser();
  await registerUser(replacement);
  await addUserToAdminGroup({ actor, member: replacement, organizationId });

  const response = await submitOrganizationGroupPolicyCommit({
    actor,
    groupId,
    groupPolicy: successor,
    organizationId,
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Principal state signer must be an admin",
  });
  expect(
    (await getCurrentPrincipalState("group", groupId, db))?.stateHash,
  ).toBe(groupState.stateHash);
});

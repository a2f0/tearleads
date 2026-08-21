import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizations,
  principalMembershipProjection,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { bytesToBase64 } from "@symcrypt/encoding";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import {
  createPolicyTestGroup,
  createSignedPrincipalState,
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("GET principal policy rejects a database-tampered projection", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, principalId);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    members: [{ userId: actor.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });
  const putResponse = await submitOrganizationGroupPolicyCommit({
    actor,
    groupId: principalId,
    groupPolicy: signedState,
    organizationId,
  });
  expect(putResponse.status).toBe(200);

  const verifiedResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(verifiedResponse.status).toBe(200);

  await db
    .update(principalMembershipProjection)
    .set({ role: "member" })
    .where(eq(principalMembershipProjection.principalId, principalId));

  const getResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(getResponse.status).toBe(409);
  expect(await getResponse.json()).toEqual({
    error:
      "Stored principal policy failed integrity verification: principal policy projection root does not match projection",
  });
});

test("GET principal policy rejects a signer key edited after verification", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, principalId);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    members: [{ userId: actor.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });
  const putResponse = await submitOrganizationGroupPolicyCommit({
    actor,
    groupId: principalId,
    groupPolicy: signedState,
    organizationId,
  });
  expect(putResponse.status).toBe(200);

  const verifiedResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
  expect(verifiedResponse.status).toBe(200);

  const replacementSigner = createTestUser();
  await db
    .update(users)
    .set({
      signingPublicKey: bytesToBase64(
        replacementSigner.signing.signingPublicKey,
      ),
    })
    .where(eq(users.id, actor.userId));

  const getResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(getResponse.status).toBe(409);
  expect(await getResponse.json()).toEqual({
    error:
      "Stored principal policy failed integrity verification: principal policy signer key fingerprint does not match public key",
  });
});

test("GET externally administered policy rejects an edited cached authority", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const [user] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, actor.userId));
  if (!user) {
    throw new Error("expected registered user");
  }
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, user.organizationId));
  if (!organization) {
    throw new Error("expected registered organization");
  }

  const groupId = crypto.randomUUID();
  const createResponse = await routeApp.request(
    `/organizations/${user.organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor,
          groupId,
          includeActorAsAdmin: false,
          name: "Externally administered",
        }),
      ),
    },
  );
  expect(createResponse.status).toBe(200);

  const policyPath = `/principals/group/${groupId}/policy`;
  const verifiedResponse = await routeApp.request(policyPath, {
    method: "GET",
    headers: { Authorization: `Bearer ${actor.token}` },
  });
  expect(verifiedResponse.status).toBe(200);

  await db
    .update(principalMembershipProjection)
    .set({ role: "member" })
    .where(
      eq(principalMembershipProjection.principalId, organization.adminGroupId),
    );

  const getResponse = await routeApp.request(policyPath, {
    method: "GET",
    headers: { Authorization: `Bearer ${actor.token}` },
  });

  expect(getResponse.status).toBe(409);
  expect(await getResponse.json()).toEqual({
    error:
      "Stored external admin policy failed integrity verification: principal policy projection root does not match projection",
  });
});

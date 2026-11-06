import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { groups as groupsTable } from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { getCurrentOrganizationAdminAuthority } from "../../../test/helpers/organizationAdmin";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import {
  createPolicyTestGroup,
  createSignedPrincipalState,
  getDefaultOrganizationId,
  putGroupPolicy,
  readCommittedGroupPolicy,
  submitOrganizationGroupPolicyCommit,
  toPolicyRequest,
} from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

// The combined write binds the exact envelope set into the signed state and
// requires the authenticated requester to be that signer. An unrelated user
// therefore cannot replace stored wraps by replaying the public policy with
// different, otherwise well-formed ciphertext.
test("PUT /principals/:principalType/:principalId/policy rejects a non-signer and preserves existing envelopes", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  // An unrelated authenticated user: registered, with a valid session, but not
  // a member of the target principal.
  const outsider = createTestUser();
  await registerUser(outsider);
  await authenticate(outsider);

  const principalId = crypto.randomUUID();
  await createPolicyTestGroup(owner.userId, principalId);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const principalKem = generateKemSeedAndKeyPair();
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    principalKem,
    members: [{ userId: owner.userId }],
    signerUserId: owner.userId,
    signerUserKeyFingerprint: owner.fingerprint,
    signingPrivateKey: owner.signing.signingPrivateKey,
  });
  const seedResponse = await putGroupPolicy({
    actor: owner,
    organizationId,
    principalId,
    signedState,
  });
  expect(seedResponse.status).toBe(200);
  await readCommittedGroupPolicy(seedResponse);
  const legitimateEnvelope = signedState.memberEnvelopes[0];
  invariant(legitimateEnvelope, "expected legitimate member envelope");

  // The bundle is not served to an account outside the principal, so the
  // outsider replays the owner's signed state obtained out of band and submits
  // alternate, real wrapped material with it.
  const outsiderPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${outsider.token}` },
    },
  );
  expect(outsiderPolicyResponse.status).toBe(403);

  const [alternateWrappedKey] = await wrapDekForRecipients(
    principalKem.secretKey,
    [owner.kem.publicKey],
  );
  invariant(alternateWrappedKey, "expected alternate member envelope");
  const alternateEnvelope = {
    ...legitimateEnvelope,
    kemCipherText: bytesToBase64(alternateWrappedKey.kemCipherText),
    wrappedKey: bytesToBase64(alternateWrappedKey.wrappedKey),
  };

  const attackResponse = await submitOrganizationGroupPolicyCommit({
    actor: outsider,
    groupId: principalId,
    groupPolicy: {
      ...toPolicyRequest(signedState),
      memberEnvelopes: [alternateEnvelope],
    },
    organizationId,
  });

  expect(attackResponse.status).toBe(403);
  expect(await attackResponse.json()).toEqual({
    error: "Principal policy signer does not match authenticated requester",
  });

  // The legitimate envelopes must survive untouched.
  const ownerPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(ownerPolicyResponse.status).toBe(200);
  const policyBundle = await ownerPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(policyBundle),
    "expected principal policy bundle response",
  );
  expect(policyBundle.currentMemberEnvelopes.envelopes).toEqual(
    signedState.memberEnvelopes,
  );
});

test("PUT /principals/:principalType/:principalId/policy rejects signers who are not admins", async () => {
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
    projection: [
      {
        userId: actor.userId,
        role: "member",
      },
    ],
  });

  const response = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState,
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Principal state signer must be an admin",
  });
});

test("PUT /principals/:principalType/:principalId/policy allows org admins to update org-scoped group policy", async () => {
  const orgAdmin = createTestUser();
  await registerUser(orgAdmin);
  await authenticate(orgAdmin);
  const organizationId = await getDefaultOrganizationId(orgAdmin.userId);

  const groupAdmin = createTestUser();
  await registerUser(groupAdmin);
  await authenticate(groupAdmin);
  await addOrganizationMember({
    actor: orgAdmin,
    member: groupAdmin,
    organizationId,
  });

  const groupId = crypto.randomUUID();
  await db.insert(groupsTable).values({
    id: groupId,
    organizationId,
  });
  const externalAuthority =
    await getCurrentOrganizationAdminAuthority(organizationId);

  const principalKem = generateKemSeedAndKeyPair();
  const initialState = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    principalKem,
    members: [],
    projection: [],
    externalAuthority,
    signerUserId: orgAdmin.userId,
    signerUserKeyFingerprint: orgAdmin.fingerprint,
    signingPrivateKey: orgAdmin.signing.signingPrivateKey,
  });
  const initialResponse = await putGroupPolicy({
    actor: orgAdmin,
    organizationId,
    principalId: groupId,
    signedState: initialState,
  });
  expect(initialResponse.status).toBe(200);
  const initialStoredPolicy = await readCommittedGroupPolicy(initialResponse);
  const initialStoredState = initialStoredPolicy.currentState;
  const successorProjection = [
    {
      userId: groupAdmin.userId,
      role: "admin" as const,
    },
    {
      userId: orgAdmin.userId,
      role: "member" as const,
    },
  ];
  const successorState = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    version: 2,
    prevStateHash: initialStoredState.stateHash,
    keyEpoch: initialStoredState.keyEpoch,
    principalKem,
    members: successorProjection.map((member) => ({ userId: member.userId })),
    projection: successorProjection,
    externalAuthority,
    signedAt: "2026-04-08T16:01:00.000Z",
    signerUserId: orgAdmin.userId,
    signerUserKeyFingerprint: orgAdmin.fingerprint,
    signingPrivateKey: orgAdmin.signing.signingPrivateKey,
  });

  const successorResponse = await putGroupPolicy({
    actor: orgAdmin,
    organizationId,
    principalId: groupId,
    signedState: successorState,
  });

  expect(successorResponse.status).toBe(200);
  const successorStoredPolicy =
    await readCommittedGroupPolicy(successorResponse);
  const successorStoredState = successorStoredPolicy.currentState;
  expect(successorStoredState.signerUserId).toBe(orgAdmin.userId);
  expect(successorStoredState.version).toBe(2);
}, 10_000);

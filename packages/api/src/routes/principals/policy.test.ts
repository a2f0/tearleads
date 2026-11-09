import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createPolicyTestGroup,
  createSignedPrincipalState,
  getDefaultOrganizationId,
  putGroupPolicy,
  readCommittedGroupPolicy,
} from "../../../test/helpers/principalPolicy";
import { createProjectionWithAdminSigner } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("PUT /principals/:principalType/:principalId/policy atomically stores and returns the current bundle", async () => {
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
  const projection = signedState.projection;
  const putPolicyResponse = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState,
  });

  expect(putPolicyResponse.status).toBe(200);
  const storedPolicy = await readCommittedGroupPolicy(putPolicyResponse);
  const storedState = storedPolicy.head;
  expect(storedState.stateHash.length).toBeGreaterThan(0);
  expect(storedState.principalId).toBe(principalId);

  const getPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${actor.token}`,
      },
    },
  );

  expect(getPolicyResponse.status).toBe(200);
  const policyBundle = await getPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(policyBundle),
    "expected principal policy bundle response",
  );
  expect(policyBundle.currentState.stateHash).toBe(storedState.stateHash);
  expect(policyBundle.currentPayload.stateHash).toBe(storedState.stateHash);
  expect(policyBundle.currentProjection).toEqual(projection);
  expect(policyBundle.currentMemberEnvelopes.principalId).toBe(principalId);
  expect(policyBundle.currentMemberEnvelopes.stateHash).toBe(
    storedState.stateHash,
  );
  expect(policyBundle.currentMemberEnvelopes.epoch).toBe(1);
  expect(policyBundle.currentMemberEnvelopes.envelopes).toEqual(
    signedState.memberEnvelopes,
  );
  expect(policyBundle.previousStates).toEqual([]);
});

test("GET /principals/:principalType/:principalId/policy returns previous states for successor verification", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);

  const principalId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, principalId);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const members = [{ userId: actor.userId }];
  const principalKem = generateKemSeedAndKeyPair();
  const projection = createProjectionWithAdminSigner(actor.userId, members);

  const initialSignedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    principalKem,
    members,
    projection,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const initialPutResponse = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState: initialSignedState,
  });

  expect(initialPutResponse.status).toBe(200);
  const initialStoredPolicy =
    await readCommittedGroupPolicy(initialPutResponse);
  const initialStoredState = initialStoredPolicy.head;

  const successorSignedState = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    principalKem,
    version: 2,
    prevStateHash: initialStoredState.stateHash,
    members,
    projection,
    signedAt: "2026-04-08T16:01:00.000Z",
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const successorPutResponse = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState: successorSignedState,
  });

  expect(successorPutResponse.status).toBe(200);
  const successorStoredPolicy =
    await readCommittedGroupPolicy(successorPutResponse);
  const successorStoredState = successorStoredPolicy.head;

  const getPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${actor.token}`,
      },
    },
  );

  expect(getPolicyResponse.status).toBe(200);
  const policyBundle = await getPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(policyBundle),
    "expected principal policy bundle response",
  );
  expect(policyBundle.currentState.stateHash).toBe(
    successorStoredState.stateHash,
  );
  expect(policyBundle.previousStates).toHaveLength(1);
  expect(policyBundle.previousStates[0]?.state.stateHash).toBe(
    initialStoredState.stateHash,
  );
  expect(policyBundle.previousStates[0]?.projection).toEqual(projection);
});

test("PUT /principals/:principalType/:principalId/policy stores signed current member wraps", async () => {
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

  const putPolicyResponse = await putGroupPolicy({
    actor,
    organizationId,
    principalId,
    signedState,
  });

  expect(putPolicyResponse.status).toBe(200);
  const storedPolicy = await readCommittedGroupPolicy(putPolicyResponse);
  const storedState = storedPolicy.head;

  const getPolicyResponse = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${actor.token}`,
      },
    },
  );

  expect(getPolicyResponse.status).toBe(200);
  const policyBundle = await getPolicyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(policyBundle),
    "expected principal policy bundle response",
  );
  expect(policyBundle.currentMemberEnvelopes.stateHash).toBe(
    storedState.stateHash,
  );
  expect(policyBundle.currentMemberEnvelopes.envelopes).toEqual(
    signedState.memberEnvelopes,
  );
});

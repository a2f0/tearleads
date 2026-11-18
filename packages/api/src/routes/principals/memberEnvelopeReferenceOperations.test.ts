import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import {
  buildOrganizationGroupDeletionRequest,
  getDefaultOrganizationId,
  runGetCurrentPrincipalPolicyWorkflow,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";

/** An organization leg kept in its epoch, sent as changes (#2903 P17). */
function byReference(
  leg: PutPrincipalPolicyRequest,
): PutPrincipalPolicyRequest {
  return {
    ...leg,
    memberEnvelopeChanges: { removeUserIds: [], upsert: [] },
    memberEnvelopes: [],
  };
}

async function owner() {
  const user = createTestUser();
  await registerAndAuthenticateUsers(user);
  return { organizationId: await getDefaultOrganizationId(user.userId), user };
}

function send(
  user: TestUser,
  path: string,
  method: "DELETE" | "POST" | "PUT",
  body: unknown,
) {
  return requestPreparedPrincipalPolicy(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.token}`,
    },
    body: JSON.stringify(body),
  });
}

/** Another directory write, so a retry can no longer replay by its head. */
async function moveDirectoryOn(o: Awaited<ReturnType<typeof owner>>) {
  const response = await send(
    o.user,
    `/organizations/${o.organizationId}/groups`,
    "POST",
    await createGroupRequest({
      actor: o.user,
      groupId: crypto.randomUUID(),
      name: "Later",
    }),
  );
  expect(response.status).toBe(200);
  await response.arrayBuffer();
}

test("a group create sent by reference replays in full after the directory moves on", async () => {
  const o = await owner();
  const full = await createGroupRequest({
    actor: o.user,
    groupId: crypto.randomUUID(),
    keepKeyWith: o.user.kem.secretKey,
    name: "Operators",
  });
  const path = `/organizations/${o.organizationId}/groups`;
  const first = await send(o.user, path, "POST", {
    ...full,
    organizationPolicy: byReference(full.organizationPolicy),
  });
  expect(first.status).toBe(200);
  const original = await first.json();
  await moveDirectoryOn(o);
  const retried = await send(o.user, path, "POST", full);
  expect(retried.status).toBe(200);
  expect(await retried.json()).toEqual(original);
});

test("a group delete sent by reference replays in full after the group is gone", async () => {
  const o = await owner();
  const groupId = crypto.randomUUID();
  const created = await send(
    o.user,
    `/organizations/${o.organizationId}/groups`,
    "POST",
    await createGroupRequest({ actor: o.user, groupId, name: "Operators" }),
  );
  expect(created.status).toBe(200);
  await created.arrayBuffer();
  const full = await buildOrganizationGroupDeletionRequest({
    actor: o.user,
    groupId,
    keepKeyWith: o.user.kem.secretKey,
    organizationId: o.organizationId,
  });
  const path = `/organizations/${o.organizationId}/groups/${groupId}`;
  const first = await send(o.user, path, "DELETE", {
    organizationPolicy: byReference(full.organizationPolicy),
  });
  expect(first.status).toBe(200);
  const original = await first.json();
  await moveDirectoryOn(o);
  const retried = await send(o.user, path, "DELETE", full);
  expect(retried.status).toBe(200);
  expect(await retried.json()).toEqual(original);
});

test("an organization put sent by reference replays in full after the head moves on", async () => {
  const o = await owner();
  const current = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "organization",
    o.organizationId,
  );
  const state = current.currentState;
  const signed = await signPrincipalStateBundle({
    principalType: "organization",
    principalId: o.organizationId,
    version: state.version + 1,
    prevStateHash: state.stateHash,
    keyEpoch: state.keyEpoch,
    encapsulationPublicKey: state.encapsulationPublicKey,
    keyFingerprint: state.keyFingerprint,
    members: current.currentProjection.map(({ userId }) => ({ userId })),
    projection: current.currentProjection,
    grants: [],
    externalAuthority: null,
    memberEnvelopes: current.currentMemberEnvelopes.envelopes.map(
      ({ kemCipherText, memberKeyFingerprint, userId, wrappedKey }) => ({
        kemCipherText,
        memberKeyFingerprint,
        userId,
        wrappedKey,
      }),
    ),
    payloadCiphertext: current.currentPayload.ciphertext,
    signedAt: new Date(Date.parse(state.signedAt) + 1_000).toISOString(),
    signerUserId: o.user.userId,
    signerUserKeyFingerprint: o.user.fingerprint,
    signingPrivateKey: o.user.signing.signingPrivateKey,
  });
  const full: PutPrincipalPolicyRequest = {
    encryptedPayload: signed.encryptedPayload,
    grants: signed.grants,
    memberEnvelopes: signed.memberEnvelopes,
    projection: signed.projection,
    state: signed.state,
  };
  const path = `/principals/organization/${o.organizationId}/policy`;
  const first = await send(o.user, path, "PUT", byReference(full));
  expect(first.status).toBe(200);
  const original = await first.json();
  await moveDirectoryOn(o);
  const retried = await send(o.user, path, "PUT", full);
  expect(retried.status).toBe(200);
  expect(await retried.json()).toEqual(original);
});

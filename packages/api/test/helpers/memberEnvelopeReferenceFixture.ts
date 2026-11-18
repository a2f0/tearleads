import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  toFingerprint,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type {
  CommitOrganizationGroupPolicyRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";
import { groupPolicyPayload } from "./groupPolicyPayload";
import { createGroupRequest } from "./organizationGroup";
import { addOrganizationMember } from "./organizationMembership";
import { registeredProjection } from "./policyProjection";
import { requestPreparedPrincipalPolicy } from "./principalHistoryRequest";
import {
  getDefaultOrganizationId,
  loadVerifiedPrincipalPolicy,
  runGetCurrentPrincipalPolicyWorkflow,
  submitOrganizationGroupPolicyCommit,
} from "./principalPolicy";
import { registerAndAuthenticateUsers } from "./principalPolicyReadFixtures";
import { signPrincipalStateBundle } from "./principalState";

export type Envelope = PutPrincipalPolicyRequest["memberEnvelopes"][number];

/**
 * A group whose owner adds `member` in the same key epoch: the owner opens
 * the group key from its own envelope and wraps it for the member.
 */
export async function groupWithSameEpochAdd() {
  const owner = createTestUser();
  const member = createTestUser();
  await registerAndAuthenticateUsers(owner, member);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  await addOrganizationMember({ actor: owner, member, organizationId });
  const groupId = crypto.randomUUID();
  const created = await requestPreparedPrincipalPolicy(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({ actor: owner, groupId, name: "Operators" }),
      ),
    },
  );
  expect(created.status).toBe(200);
  await created.arrayBuffer();
  const bundle = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "group",
    groupId,
  );
  const current = await loadVerifiedPrincipalPolicy(db, "group", groupId);
  const retained: Envelope[] = bundle.currentMemberEnvelopes.envelopes.map(
    ({ kemCipherText, memberKeyFingerprint, userId, wrappedKey }) => ({
      kemCipherText,
      memberKeyFingerprint,
      userId,
      wrappedKey,
    }),
  );
  const groupSecret = await unwrapDek(
    retained.map((envelope) => ({
      keyFingerprint: envelope.memberKeyFingerprint,
      kemCipherText: base64ToBytes(envelope.kemCipherText),
      wrappedKey: base64ToBytes(envelope.wrappedKey),
    })),
    owner.kem.secretKey,
  );
  const [wrapped] = await wrapDekForRecipients(groupSecret, [
    member.kem.publicKey,
  ]);
  invariant(wrapped, "expected the added member's envelope");
  const added: Envelope = {
    kemCipherText: bytesToBase64(wrapped.kemCipherText),
    memberKeyFingerprint: await toFingerprint(member.kem.publicKey),
    userId: member.userId,
    wrappedKey: bytesToBase64(wrapped.wrappedKey),
  };
  const projection = await registeredProjection([
    ...current.projection.map(({ role, userId }) => ({ role, userId })),
    { role: "member" as const, userId: member.userId },
  ]);
  const sign = async (
    keyEpoch: number,
    memberEnvelopes: Envelope[],
    signer: TestUser = owner,
  ): Promise<PutPrincipalPolicyRequest> => {
    const signed = await signPrincipalStateBundle({
      principalType: "group",
      principalId: groupId,
      version: current.version + 1,
      prevStateHash: current.stateHash,
      keyEpoch,
      encapsulationPublicKey: current.state.encapsulationPublicKey,
      keyFingerprint: current.state.keyFingerprint,
      members: projection.map(({ userId }) => ({ userId })),
      projection,
      grants: [],
      memberEnvelopes,
      payloadCiphertext: await groupPolicyPayload(groupId, projection),
      signedAt: new Date(
        Date.parse(current.state.signedAt) + 1_000,
      ).toISOString(),
      signerUserId: signer.userId,
      signerUserKeyFingerprint: signer.fingerprint,
      signingPrivateKey: signer.signing.signingPrivateKey,
    });
    return {
      encryptedPayload: signed.encryptedPayload,
      grants: signed.grants,
      memberEnvelopes: signed.memberEnvelopes,
      projection: signed.projection,
      state: signed.state,
    };
  };
  return { added, current, groupId, organizationId, owner, retained, sign };
}

/** The group leg sent as changes: an empty list and the added envelope. */
export function byReference(
  leg: PutPrincipalPolicyRequest,
  upsert: Envelope[],
): PutPrincipalPolicyRequest {
  return {
    ...leg,
    memberEnvelopeChanges: { removeUserIds: [], upsert },
    memberEnvelopes: [],
  };
}

export async function commit(
  f: Awaited<ReturnType<typeof groupWithSameEpochAdd>>,
  groupPolicy: PutPrincipalPolicyRequest,
) {
  let body: CommitOrganizationGroupPolicyRequest | null = null;
  const response = await submitOrganizationGroupPolicyCommit({
    actor: f.owner,
    groupId: f.groupId,
    groupPolicy,
    organizationId: f.organizationId,
    request: (path, init) => {
      body = JSON.parse(String(init.body));
      return routeApp.request(path, init);
    },
  });
  return { body, response };
}

export function resend(
  f: Awaited<ReturnType<typeof groupWithSameEpochAdd>>,
  body: CommitOrganizationGroupPolicyRequest,
) {
  return routeApp.request(
    `/organizations/${f.organizationId}/groups/${f.groupId}/policy-commit`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${f.owner.token}`,
      },
      body: JSON.stringify(body),
    },
  );
}

/** A same-epoch successor of the group's current head with the same set. */
export async function advanceGroupHead(
  f: Awaited<ReturnType<typeof groupWithSameEpochAdd>>,
) {
  const head = await loadVerifiedPrincipalPolicy(db, "group", f.groupId);
  const bundle = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "group",
    f.groupId,
  );
  const signed = await signPrincipalStateBundle({
    principalType: "group",
    principalId: f.groupId,
    version: head.version + 1,
    prevStateHash: head.stateHash,
    keyEpoch: head.keyEpoch,
    encapsulationPublicKey: head.state.encapsulationPublicKey,
    keyFingerprint: head.state.keyFingerprint,
    members: head.projection.map(({ userId }) => ({ userId })),
    projection: head.projection,
    grants: [],
    memberEnvelopes: bundle.currentMemberEnvelopes.envelopes.map(
      ({ kemCipherText, memberKeyFingerprint, userId, wrappedKey }) => ({
        kemCipherText,
        memberKeyFingerprint,
        userId,
        wrappedKey,
      }),
    ),
    payloadCiphertext: await groupPolicyPayload(f.groupId, head.projection),
    signedAt: new Date(Date.parse(head.state.signedAt) + 1_000).toISOString(),
    signerUserId: f.owner.userId,
    signerUserKeyFingerprint: f.owner.fingerprint,
    signingPrivateKey: f.owner.signing.signingPrivateKey,
  });
  const { response } = await commit(f, {
    encryptedPayload: signed.encryptedPayload,
    grants: signed.grants,
    memberEnvelopes: signed.memberEnvelopes,
    projection: signed.projection,
    state: signed.state,
  });
  expect(response.status).toBe(200);
  await response.arrayBuffer();
}

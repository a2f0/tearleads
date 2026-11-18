import { expect, test } from "bun:test";
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
import { groupPolicyPayload } from "../../../test/helpers/groupPolicyPayload";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import { registeredProjection } from "../../../test/helpers/policyProjection";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import {
  buildOrganizationGroupPolicyCommitRequest,
  getDefaultOrganizationId,
  loadVerifiedPrincipalPolicy,
  runGetCurrentPrincipalPolicyWorkflow,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { routeApp } from "../../routeApp";

type Envelope = PutPrincipalPolicyRequest["memberEnvelopes"][number];

/**
 * A group whose owner adds `member` in the same key epoch: the owner opens
 * the group key from its own envelope and wraps it for the member.
 */
async function groupWithSameEpochAdd() {
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
function byReference(
  leg: PutPrincipalPolicyRequest,
  upsert: Envelope[],
): PutPrincipalPolicyRequest {
  return {
    ...leg,
    memberEnvelopeChanges: { removeUserIds: [], upsert },
    memberEnvelopes: [],
  };
}

async function commit(
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

function resend(
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

test("a same-epoch group leg sent as changes stores the signed full set", async () => {
  const f = await groupWithSameEpochAdd();
  const full = await f.sign(f.current.keyEpoch, [...f.retained, f.added]);
  const { body, response } = await commit(f, byReference(full, [f.added]));
  expect(response.status).toBe(200);
  const original = await response.json();
  const stored = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "group",
    f.groupId,
  );
  expect(stored.currentState).toMatchObject({
    keyEpoch: f.current.keyEpoch,
    memberEnvelopesRoot: full.state.memberEnvelopesRoot,
    version: f.current.version + 1,
  });
  expect(
    stored.currentMemberEnvelopes.envelopes.map((envelope) => envelope.userId),
  ).toEqual([...f.retained, f.added].map((envelope) => envelope.userId).sort());

  // A retry in the other form, in any envelope order, is the same request:
  // it replays the commit.
  invariant(body, "expected the sent request");
  const sent: CommitOrganizationGroupPolicyRequest = body;
  for (const memberEnvelopes of [
    full.memberEnvelopes,
    [...full.memberEnvelopes].reverse(),
  ]) {
    const retried = await resend(f, {
      ...sent,
      groupPolicy: { ...full, memberEnvelopes },
    });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(original);
  }
});

test("a rebuild reveals nothing before the route and admin are checked", async () => {
  const f = await groupWithSameEpochAdd();
  const outsider = createTestUser();
  await registerAndAuthenticateUsers(outsider);
  // Signed by the outsider, so it passes the signer binding before the
  // transaction and reaches the rebuild.
  const full = await f.sign(
    f.current.keyEpoch,
    [...f.retained, f.added],
    outsider,
  );
  const cited = byReference(full, [f.added]);
  const unknown = {
    ...cited,
    state: { ...cited.state, prevStateHash: "0".repeat(64) },
  };
  const answers = [];
  for (const groupPolicy of [cited, unknown]) {
    const response = await routeApp.request(
      `/organizations/${f.organizationId}/groups/${f.groupId}/policy-commit`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${outsider.token}`,
        },
        body: JSON.stringify(
          await buildOrganizationGroupPolicyCommitRequest({
            actor: outsider,
            groupPolicy,
            organizationId: f.organizationId,
          }),
        ),
      },
    );
    answers.push({ body: await response.text(), status: response.status });
  }
  expect(answers[0]?.status).toBe(403);
  expect(answers[1]).toEqual(answers[0]);
});

test("group create and delete refuse bad changes with a typed error", async () => {
  const f = await groupWithSameEpochAdd();
  const directory = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "organization",
    f.organizationId,
  );
  const stale = (
    leg: PutPrincipalPolicyRequest,
  ): PutPrincipalPolicyRequest => ({
    ...leg,
    memberEnvelopeChanges: { removeUserIds: [], upsert: [] },
    memberEnvelopes: [],
    state: { ...leg.state, prevStateHash: "0".repeat(64) },
  });
  const created = await createGroupRequest({
    actor: f.owner,
    groupId: crypto.randomUUID(),
    name: "Stale",
  });
  const responses = [
    await routeApp.request(`/organizations/${f.organizationId}/groups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${f.owner.token}`,
      },
      body: JSON.stringify({
        ...created,
        organizationPolicy: stale(created.organizationPolicy),
      }),
    }),
    await routeApp.request(
      `/organizations/${f.organizationId}/groups/${f.groupId}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${f.owner.token}`,
        },
        body: JSON.stringify({
          organizationPolicy: stale(created.organizationPolicy),
        }),
      },
    ),
  ];
  for (const response of responses) {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Member envelope changes cite an unknown predecessor state",
    });
  }
  expect(
    (
      await runGetCurrentPrincipalPolicyWorkflow(
        db,
        "organization",
        f.organizationId,
      )
    ).currentState.stateHash,
  ).toBe(directory.currentState.stateHash);
});

test("changes that do not rebuild the signed root are refused whole", async () => {
  const f = await groupWithSameEpochAdd();
  const full = await f.sign(f.current.keyEpoch, [...f.retained, f.added]);
  // The right recipient and fingerprint, wrapping other key material.
  const forged = { ...f.added, wrappedKey: f.retained[0]?.wrappedKey ?? "" };
  const { response } = await commit(f, byReference(full, [forged]));
  expect(response.status).toBe(400);
  expect(await response.text()).toContain(
    "Principal state memberEnvelopesRoot does not match member envelopes",
  );
  expect(
    (await runGetCurrentPrincipalPolicyWorkflow(db, "group", f.groupId))
      .currentState.stateHash,
  ).toBe(f.current.stateHash);
});

test("a leg sending both a list and changes is refused", async () => {
  const f = await groupWithSameEpochAdd();
  const full = await f.sign(f.current.keyEpoch, [...f.retained, f.added]);
  const { response } = await commit(f, {
    ...byReference(full, [f.added]),
    memberEnvelopes: full.memberEnvelopes,
  });
  expect(response.status).toBe(400);
  expect(await response.text()).toContain(
    "Member envelope changes replace the envelope list, which must be empty",
  );
});

test("changes are refused outside the predecessor's key epoch", async () => {
  const f = await groupWithSameEpochAdd();
  const advanced = await f.sign(f.current.keyEpoch + 1, [
    ...f.retained,
    f.added,
  ]);
  const { response } = await commit(f, byReference(advanced, [f.added]));
  expect(response.status).toBe(400);
  expect(await response.text()).toContain(
    "Member envelope changes require the predecessor's key epoch",
  );
});

import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  buildInitialGroupPolicyRequest,
  testGroupMetadataKey,
} from "../../../../test/helpers/data/groupMetadata";
import { policyBundleFromInitialRequest } from "../../../../test/helpers/data/principalPolicyFixtures";
import { createFixtureUserIdentity } from "../../../../test/helpers/data/trustedUserIdentity";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import {
  withHeldMemberEnvelopeChanges,
  withMemberEnvelopeChanges,
} from "../../../data/principals/memberEnvelopeReferences";
import { buildAddGroupUserPolicyRequest } from "../groupPolicy/groupPolicyRequests";

/** A group and its successor adding one member in the same key epoch. */
async function sameEpochAdd() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const predecessor = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      metadataKey: testGroupMetadataKey(organizationId),
      creatorEncapsulationKeyPair: creatorKem,
      groupId,
      name: "Operators",
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
  );
  const { identity: added } = await createFixtureUserIdentity({
    userId: crypto.randomUUID(),
  });
  const successor = await buildAddGroupUserPolicyRequest({
    currentPolicy: predecessor,
    currentPolicySignerPublicKeys: [
      {
        userId: signerUserId,
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      },
    ],
    currentUsers: [],
    currentUserSecretKey: creatorKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
    targetUser: added,
  });
  return { added, organizationId, predecessor, successor };
}

test("a same-epoch leg sends only its added envelope", async () => {
  const f = await sameEpochAdd();
  expect(f.successor.state.keyEpoch).toBe(f.predecessor.currentState.keyEpoch);
  const leg = withMemberEnvelopeChanges(f.successor, f.predecessor);
  expect(leg.memberEnvelopes).toEqual([]);
  expect(leg.memberEnvelopeChanges).toEqual({
    removeUserIds: [],
    upsert: f.successor.memberEnvelopes.filter(
      (envelope) => envelope.userId === f.added.userId,
    ),
  });
});

test("a leg outside the held predecessor or its epoch goes in full", async () => {
  const f = await sameEpochAdd();
  for (const state of [
    { ...f.successor.state, keyEpoch: f.successor.state.keyEpoch + 1 },
    { ...f.successor.state, prevStateHash: "0".repeat(64) },
  ]) {
    const leg = { ...f.successor, state };
    expect(withMemberEnvelopeChanges(leg, f.predecessor)).toBe(leg);
  }
});

test("a journaled mutation uses changes only against a held, rooted predecessor", async () => {
  const f = await sameEpochAdd();
  const { close, execSql } = await createTestExecSql("member-envelope-changes");
  const mutation = {
    kind: "organization" as const,
    groupId: null,
    request: f.successor,
  };
  try {
    // Nothing held: the leg goes in full.
    expect(await withHeldMemberEnvelopeChanges(execSql, mutation)).toEqual(
      mutation,
    );
    const repository = new PrincipalPolicyBundleRepository(execSql);
    await repository.savePrincipalPolicyBundle(f.predecessor, f.organizationId);
    const compact = await withHeldMemberEnvelopeChanges(execSql, mutation);
    if (compact.kind !== "organization") throw new Error("expected the leg");
    expect(compact.request.memberEnvelopes).toEqual([]);
    expect(compact.request.memberEnvelopeChanges?.upsert).toHaveLength(1);
  } finally {
    close();
  }
});

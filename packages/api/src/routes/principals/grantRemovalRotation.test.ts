import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { groupPolicyPayload } from "../../../test/helpers/groupPolicyPayload";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { buildRootRevokeRequest } from "../../../test/helpers/keyingWriterProjectionRevoke";
import {
  loadVerifiedPrincipalPolicy,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { grantRootThroughRotatedReadGroup } from "../../../test/helpers/rotatedReadGroupGrant";
import { listCurrentPrincipalMemberEnvelopes } from "../../access/read/principalMemberEnvelopes";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";

// Real signed setup and protocol steps approach five seconds in PGlite CI.
test("a group cannot drop a container grant without rotating its key", async () => {
  const owner = createTestUser();
  const reader = createTestUser();
  await registerAndAuthenticate(owner, reader);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const { groupId, root: grantedRoot } = await grantRootThroughRotatedReadGroup(
    { actor: owner, reader, root },
  );
  const current = await loadVerifiedPrincipalPolicy(db, "group", groupId);
  // The same key and member envelopes at the same epoch, minus the grant: a
  // member added later could open the root KEK wraps kept for this key.
  const memberEnvelopes = (
    await listCurrentPrincipalMemberEnvelopes("group", groupId, db)
  ).map((envelope) => ({
    userId: envelope.userId,
    memberKeyFingerprint: envelope.memberKeyFingerprint,
    kemCipherText: envelope.kemCipherText,
    wrappedKey: envelope.wrappedKey,
  }));
  const sameEpoch = await signPrincipalStateBundle({
    principalType: "group",
    principalId: groupId,
    version: current.version + 1,
    prevStateHash: current.stateHash,
    keyEpoch: current.keyEpoch,
    encapsulationPublicKey: current.state.encapsulationPublicKey,
    keyFingerprint: current.state.keyFingerprint,
    members: current.projection.map((member) => ({ userId: member.userId })),
    projection: current.projection,
    grants: [],
    memberEnvelopes,
    payloadCiphertext: await groupPolicyPayload(groupId, current.projection),
    signedAt: new Date(
      Date.parse(current.state.signedAt) + 1_000,
    ).toISOString(),
    signerUserId: owner.userId,
    signerUserKeyFingerprint: owner.fingerprint,
    signingPrivateKey: owner.signing.signingPrivateKey,
  });
  const revoke = await buildRootRevokeRequest({
    previous: grantedRoot.bundle,
    previousKekState: grantedRoot.kekState,
    revokedGrant: { subjectId: groupId, subjectType: "group" },
    signer: owner,
  });
  revoke.principalPolicies = (revoke.principalPolicies ?? []).filter(
    (policy) => Reflect.get(policy, "principalId") !== groupId,
  );

  const response = await submitOrganizationGroupPolicyCommit({
    actor: owner,
    groupId,
    groupPolicy: {
      state: sameEpoch.state,
      encryptedPayload: sameEpoch.encryptedPayload,
      projection: sameEpoch.projection,
      grants: sameEpoch.grants,
      memberEnvelopes: sameEpoch.memberEnvelopes,
      containerMutations: [revoke],
    },
    organizationId: asVerifiedContainerManifest(grantedRoot.bundle).state
      .organizationId,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Principal policy grant removal requires a new key epoch",
  });
  expect(
    (await getCurrentPrincipalState("group", groupId, db))?.stateHash,
  ).toBe(current.stateHash);
}, 15_000);

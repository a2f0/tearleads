import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import {
  buildAddGroupUserPolicyRequest,
  buildGroupAccessSetShrinkPolicyRequest,
  buildRemoveGroupUserPolicyRequest,
  buildSetGroupContainerGrantPolicyRequest,
} from "./groupPolicyRequests";
import {
  buildInitialGroupPolicyRequest,
  readGroupPolicyPayloadName,
} from "./principalPolicyRequest";

// Every successor state a group signs must carry the predecessor's display
// name forward: a mutation that dropped it would orphan the group, since no
// share could bind a name to it again.
test("successor group policies carry the signed name forward", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signerKem = generateKemSeedAndKeyPair();
  const memberKem = generateKemSeedAndKeyPair();
  const memberSigning = generateSigningSeedAndKeyPair();
  const signerUserId = "signer-user";
  const memberUserId = "member-user";
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  // Member envelopes are checked against the identity's real key fingerprint.
  const signerIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(signerKem.publicKey),
    encapsulationPublicKey: signerKem.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId: signerUserId,
  });
  const memberIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(memberKem.publicKey),
    encapsulationPublicKey: memberKem.publicKey,
    signingKeyFingerprint: await toFingerprint(memberSigning.signingPublicKey),
    signingPublicKey: memberSigning.signingPublicKey,
    userId: memberUserId,
  });
  const initialPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: signerKem,
      groupId: "group-1",
      name: "Operators",
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
  );
  const base = (currentPolicy: PrincipalPolicyBundleResponse) => ({
    currentPolicy,
    currentPolicySignerPublicKeys: [
      {
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
        userId: signerUserId,
      },
    ],
    currentUserSecretKey: signerKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const successor = async (
    previous: PrincipalPolicyBundleResponse,
    mutation: PutPrincipalPolicyRequest,
  ): Promise<PrincipalPolicyBundleResponse> => {
    const bundle = await policyBundleAfterMutation({ mutation, previous });
    expect(readGroupPolicyPayloadName(bundle)).toBe("Operators");
    return bundle;
  };

  const withMember = await successor(
    initialPolicy,
    await buildAddGroupUserPolicyRequest({
      ...base(initialPolicy),
      currentUsers: [signerIdentity],
      targetUser: memberIdentity,
    }),
  );
  const withGrant = await successor(
    withMember,
    await buildSetGroupContainerGrantPolicyRequest({
      ...base(withMember),
      accessLevel: "read",
      containerId: "container-1",
    }),
  );
  const shrunk = await successor(
    withGrant,
    await buildGroupAccessSetShrinkPolicyRequest({
      ...base(withGrant),
      currentUsers: [signerIdentity, memberIdentity],
      revokedContainerId: "container-1",
    }),
  );
  await successor(
    shrunk,
    await buildRemoveGroupUserPolicyRequest({
      ...base(shrunk),
      remainingUsers: [signerIdentity],
      removedUserId: memberUserId,
    }),
  );
});

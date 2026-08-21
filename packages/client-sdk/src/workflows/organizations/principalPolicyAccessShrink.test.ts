import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@symcrypt/crypto";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { buildGroupAccessSetShrinkPolicyRequest } from "./groupPolicyRequests";
import { buildInitialGroupPolicyRequest } from "./principalPolicy";

test("access-set shrink preserves membership while rotating the group key", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const memberKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const revokedContainerId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: memberKem,
      grants: [{ accessLevel: "read", containerId: revokedContainerId }],
      groupId: crypto.randomUUID(),
      name: "Operators",
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
  );
  const accessShrinkRequest = await buildGroupAccessSetShrinkPolicyRequest({
    currentPolicy: initialPolicy,
    currentPolicySignerPublicKeys: [
      {
        userId: signerUserId,
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      },
    ],
    currentUsers: [
      createTestTrustedUserIdentity({
        userId: signerUserId,
        encapsulationPublicKey: memberKem.publicKey,
        encapsulationKeyFingerprint: await toFingerprint(memberKem.publicKey),
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      }),
    ],
    revokedContainerId,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });

  expect(accessShrinkRequest.projection).toEqual(
    initialPolicy.currentProjection,
  );
  expect(accessShrinkRequest.state.keyEpoch).toBe(2);
  expect(accessShrinkRequest.state.keyFingerprint).not.toBe(
    initialPolicy.currentState.keyFingerprint,
  );
  expect(accessShrinkRequest.memberEnvelopes).toHaveLength(1);
});

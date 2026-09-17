import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { buildInitialGroupPolicyRequest } from "../../../test/helpers/groupMetadata";

test("buildInitialGroupPolicyRequest creates an admin-only initial group policy", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );

  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: encapsulationKeyPair,
    groupId,
    name: " Operators ",
    signerUserId: userId,
    signingFingerprint,
    signingKeyPair,
  });

  expect(request).not.toHaveProperty("name");
  expect(request.initialGroupPolicy.state.principalType).toBe("group");
  expect(request.initialGroupPolicy.state.principalId).toBe(groupId);
  expect(request.initialGroupPolicy.state.version).toBe(1);
  expect(request.initialGroupPolicy.projection).toEqual([
    {
      userId: userId,
      role: "admin",
    },
  ]);
  expect(request.initialGroupPolicy.memberEnvelopes[0]?.userId).toBe(userId);
});

test("buildInitialGroupPolicyRequest can create an externally-administered empty initial group policy", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );

  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: encapsulationKeyPair,
    groupId,
    includeSignerAsAdmin: false,
    name: " Operators ",
    signerUserId: userId,
    signingFingerprint,
    signingKeyPair,
  });

  expect(request).not.toHaveProperty("name");
  expect(request.initialGroupPolicy.state.principalType).toBe("group");
  expect(request.initialGroupPolicy.state.principalId).toBe(groupId);
  expect(request.initialGroupPolicy.state.version).toBe(1);
  expect(request.initialGroupPolicy.state.memberCount).toBe(0);
  expect(request.initialGroupPolicy.projection).toEqual([]);
  expect(request.initialGroupPolicy.memberEnvelopes).toEqual([]);
});

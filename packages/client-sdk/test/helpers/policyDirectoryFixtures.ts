import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalPolicyBundleResponse,
  UserIdentityResponse,
} from "@tearleads/validators/response";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import {
  organizationPolicyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";

export interface PolicyDirectoryFixture {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly signer: UserIdentityResponse;
  readonly signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
}

export async function createPolicyDirectoryFixture(input: {
  readonly organizationId: string;
  readonly group: PrincipalPolicyBundleResponse;
}): Promise<PolicyDirectoryFixture> {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const adminGroupId = input.group.currentState.principalId;
  const memberGroupId = "directory-members";
  const policy = await buildInitialOrganizationPolicyRequest({
    adminGroupId,
    memberGroupId,
    organizationId: input.organizationId,
    groupHeads: [
      principalPolicyHead(input.group),
      principalPolicyHead(input.group, memberGroupId),
    ],
    encapsulationPublicKey: kem.publicKey,
    signingKeyPair,
    userId,
  });
  return {
    signingKeyPair,
    bundle: await organizationPolicyBundleFromInitialRequest(
      input.organizationId,
      policy,
    ),
    signer: {
      userId,
      signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
      signingKeyFingerprint: await toFingerprint(
        signingKeyPair.signingPublicKey,
      ),
      encapsulationPublicKey: bytesToBase64(kem.publicKey),
      encapsulationKeyFingerprint: await toFingerprint(kem.publicKey),
    },
  };
}

import {
  buildInitialGroupPolicyRequest,
  type recoverPrincipalPolicyHistory,
} from "@tearleads/client-sdk";
import { createTestTrustedUserIdentityResolver } from "@tearleads/client-sdk/testing";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

type RecoveryInput = Parameters<typeof recoverPrincipalPolicyHistory>[0];
type BackupPolicyProducer = {
  bundle: PrincipalPolicyBundleResponse;
  head: RecoveryInput["expectedHead"];
  request: Awaited<
    ReturnType<typeof buildInitialGroupPolicyRequest>
  >["initialGroupPolicy"];
  signerUserId: string;
  signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
  signingFingerprint: string;
  creatorEncapsulationKeyPair: ReturnType<typeof generateKemSeedAndKeyPair>;
  historyReader: RecoveryInput["historyReader"];
  resolveTrustedUserIdentity: ReturnType<
    typeof createTestTrustedUserIdentityResolver
  >;
};

/** A real SDK-authored policy for the signature-verifying recovery reader. */
export async function createBackupPolicyProducer(): Promise<BackupPolicyProducer> {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorEncapsulationKeyPair = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const { initialGroupPolicy: request } = await buildInitialGroupPolicyRequest({
    identityTrustDomain: "https://api.example.test",
    signingKeyPair,
    creatorEncapsulationKeyPair,
    signerUserId,
    signingFingerprint,
    groupId: crypto.randomUUID(),
    name: "Admins",
    builtinRole: "admins",
  });
  const stateHash = await computePrincipalStateHash(request.state);
  const { principalType, principalId, keyEpoch } = request.state;
  const head = {
    principalType,
    principalId,
    keyEpoch,
    stateHash,
    keyFingerprint: request.state.keyFingerprint,
    version: request.state.version,
  };
  const createdAt = request.state.signedAt;
  const bundle: PrincipalPolicyBundleResponse = {
    currentState: { ...request.state, stateHash, createdAt },
    currentProjection: request.projection,
    currentGrants: request.grants,
    currentPayload: {
      ...request.encryptedPayload,
      principalType,
      principalId,
      stateHash,
      createdAt,
    },
    currentMemberEnvelopes: {
      envelopes: request.memberEnvelopes,
      epoch: keyEpoch,
      principalType,
      principalId,
      stateHash,
    },
    previousStates: [],
  };
  const historyReader = {
    async *getPrincipalPolicyPages() {
      yield {
        ok: true as const,
        data: {
          ...bundle,
          historyPage: { afterVersion: 0, nextAfterVersion: null },
        },
      };
    },
  };
  return {
    bundle,
    head,
    request,
    signerUserId,
    signingKeyPair,
    signingFingerprint,
    creatorEncapsulationKeyPair,
    historyReader,
    resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
      userId: signerUserId,
      signingPublicKey: signingKeyPair.signingPublicKey,
      signingKeyFingerprint: signingFingerprint,
      encapsulationPublicKey: creatorEncapsulationKeyPair.publicKey,
      encapsulationKeyFingerprint: await toFingerprint(
        creatorEncapsulationKeyPair.publicKey,
      ),
    }),
  };
}

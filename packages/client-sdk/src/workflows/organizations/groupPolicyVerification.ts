import {
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicySignerPublicKey,
  type SigningKeyPair,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type {
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { throwKeyingVerificationErrorWithContext } from "../../data/keyingProjectionVerification/error";
import { loadPrincipalPolicyVerificationCheckpoint } from "../../data/persistence/principalPolicyCheckpointSelection";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  collectPrincipalPolicySignerPublicKeys,
  type PrincipalPolicySignerPublicKeyLoadErrorCode,
} from "../principals/policyVerification";

interface GroupPolicyVerificationApi {
  getEncapsulationKey: (
    userId: string,
  ) => Promise<EncapsulationKeyResponse | null>;
}

function signerPublicKeyLoadErrorMessage(
  code: PrincipalPolicySignerPublicKeyLoadErrorCode,
): string {
  switch (code) {
    case "fingerprint-invalid":
      return "Group policy signer key fingerprint is invalid";
    case "fingerprint-mismatch":
      return "Group policy signer key fingerprint mismatch";
    case "not-found":
      return "Group policy signer key could not be loaded";
    case "user-mismatch":
      return "Group policy signer key user mismatch";
  }
}

export async function collectGroupPolicySignerPublicKeys(input: {
  readonly apiClient: GroupPolicyVerificationApi;
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly currentUserSigningKey: {
    readonly signerUserId: string;
    readonly signingFingerprint: string;
    readonly signingKeyPair: SigningKeyPair;
  };
}): Promise<PrincipalPolicySignerPublicKey[]> {
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle: input.bundle,
    getEncapsulationKey: (userId) =>
      input.apiClient.getEncapsulationKey(userId),
    trustedSignerPublicKeys: [
      {
        signerUserId: input.currentUserSigningKey.signerUserId,
        signingFingerprint: input.currentUserSigningKey.signingFingerprint,
        signingPublicKey:
          input.currentUserSigningKey.signingKeyPair.signingPublicKey,
      },
    ],
  });

  if ("error" in signerPublicKeys) {
    throw new Error(signerPublicKeyLoadErrorMessage(signerPublicKeys.error));
  }

  return signerPublicKeys.signerPublicKeys;
}

export async function verifyGroupPolicy(input: {
  readonly externalAdminSignerUserIds?: readonly string[];
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly localPolicyCheckpoint: PrincipalPolicyCheckpoint | null;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}): Promise<VerifiedPrincipalPolicy> {
  const state = input.currentPolicy.currentState;
  const verified = await verifyPrincipalPolicyBundle({
    bundle: input.currentPolicy,
    ...(input.externalAdminSignerUserIds
      ? { externalAdminSignerUserIds: input.externalAdminSignerUserIds }
      : {}),
    expectedReference: {
      principalType: "group",
      principalId: state.principalId,
      version: state.version,
      keyEpoch: state.keyEpoch,
      stateHash: state.stateHash,
      keyFingerprint: state.keyFingerprint,
    },
    localCheckpoint: input.localPolicyCheckpoint,
    signerPublicKeys: input.signerPublicKeys,
  });

  if (!verified.ok) {
    throwKeyingVerificationErrorWithContext(
      verified.error,
      "Group policy verification failed",
    );
  }

  return verified.value;
}

export async function prepareGroupPolicyVerification(input: {
  readonly apiClient: GroupPolicyVerificationApi;
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<{
  readonly currentPolicySignerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  readonly localPolicyCheckpoint: PrincipalPolicyCheckpoint | null;
}> {
  const principalId = input.currentPolicy.currentState.principalId;
  const cachedPolicy = await loadPrincipalPolicyBundle(
    input.execSql,
    "group",
    principalId,
  );
  const localPolicyCheckpoint = await loadPrincipalPolicyVerificationCheckpoint(
    {
      cachedBundle: cachedPolicy,
      execSql: input.execSql,
      principalId,
      principalType: "group",
    },
  );

  return {
    currentPolicySignerPublicKeys: await collectGroupPolicySignerPublicKeys({
      apiClient: input.apiClient,
      bundle: input.currentPolicy,
      currentUserSigningKey: {
        signerUserId: input.signerUserId,
        signingFingerprint: input.signingFingerprint,
        signingKeyPair: input.signingKeyPair,
      },
    }),
    localPolicyCheckpoint,
  };
}

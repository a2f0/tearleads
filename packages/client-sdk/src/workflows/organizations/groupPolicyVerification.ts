import {
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicySignerPublicKey,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { throwKeyingVerificationErrorWithContext } from "../../data/keyingProjectionVerification/error";
import { loadPrincipalPolicyVerificationCheckpoint } from "../../data/persistence/principalPolicyCheckpointSelection";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  collectPrincipalPolicySignerPublicKeys,
  type PrincipalPolicySignerPublicKeyLoadErrorCode,
} from "../principals/policyVerification";

function signerPublicKeyLoadErrorMessage(
  code: PrincipalPolicySignerPublicKeyLoadErrorCode,
): string {
  switch (code) {
    case "fingerprint-mismatch":
      return "Group policy signer key fingerprint mismatch";
    case "not-found":
      return "Group policy signer key could not be loaded";
  }
}

export async function collectGroupPolicySignerPublicKeys(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<PrincipalPolicySignerPublicKey[]> {
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle: input.bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
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
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
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
      bundle: input.currentPolicy,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    }),
    localPolicyCheckpoint,
  };
}

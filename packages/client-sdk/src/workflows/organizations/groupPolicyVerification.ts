import {
  type KeyingVerificationResult,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyExternalAuthority,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { throwKeyingVerificationErrorWithContext } from "../../data/keyingProjectionVerification/error";
import { loadPrincipalPolicyVerificationCheckpoint } from "../../data/persistence/principalPolicyCheckpointSelection";
import { verifyPrincipalPolicyBundleWithExternalOrganizationAdmins } from "../../data/principalPolicyAdminSigners";
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

function groupPolicyReference(
  bundle: PrincipalPolicyBundleResponse,
): ReferencedPrincipalHead {
  const state = bundle.currentState;
  return {
    principalType: "group",
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
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
  readonly externalAuthority?: PrincipalPolicyExternalAuthority;
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly localPolicyCheckpoint: PrincipalPolicyCheckpoint | null;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}): Promise<VerifiedPrincipalPolicy> {
  const verified = await verifyPrincipalPolicyBundle({
    bundle: input.currentPolicy,
    ...(input.externalAuthority
      ? { externalAuthority: input.externalAuthority }
      : {}),
    expectedReference: groupPolicyReference(input.currentPolicy),
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

export async function verifyGroupPolicyWithExternalOrganizationAdmins(input: {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly loadExternalAuthority: () => Promise<PrincipalPolicyExternalAuthority | null>;
  readonly localPolicyCheckpoint: PrincipalPolicyCheckpoint | null;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}): Promise<VerifiedPrincipalPolicy> {
  const verified: KeyingVerificationResult<VerifiedPrincipalPolicy> =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle: input.currentPolicy,
      expectedReference: groupPolicyReference(input.currentPolicy),
      loadExternalAuthority: input.loadExternalAuthority,
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
  const localPolicyCheckpoint = await loadPrincipalPolicyVerificationCheckpoint(
    {
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

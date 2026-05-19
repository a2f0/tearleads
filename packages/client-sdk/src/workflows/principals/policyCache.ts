import {
  type PrincipalPolicyBundle,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type {
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  collectPrincipalPolicySignerPublicKeys,
  type PrincipalPolicySignerPublicKeyLoadErrorCode,
  principalPolicyCheckpoint,
  principalPolicyStates,
} from "./policyVerification";

export interface CacheReferencedPrincipalPoliciesOptions {
  execSql: ExecSql;
  getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  getEncapsulationKey: (
    userId: string,
  ) => Promise<EncapsulationKeyResponse | null>;
  log?: (message: string) => void;
  references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined;
}

function getReferencedPrincipalKey(
  reference: ReferencedPrincipalStateResponse,
): string {
  return `${reference.principalType}:${reference.principalId}`;
}

function dedupeReferencedPrincipals(
  references: ReadonlyArray<ReferencedPrincipalStateResponse>,
): ReferencedPrincipalStateResponse[] {
  const referencesByPrincipal = new Map<
    string,
    ReferencedPrincipalStateResponse
  >();

  for (const reference of references) {
    referencesByPrincipal.set(getReferencedPrincipalKey(reference), reference);
  }

  return Array.from(referencesByPrincipal.values());
}

function getBundleReferenceMismatchReason(
  reference: ReferencedPrincipalStateResponse,
  bundle: PrincipalPolicyBundleResponse,
): string | null {
  const states = principalPolicyStates(bundle);
  const hasReferencedPrincipal = states.some(
    (state) =>
      state.principalType === reference.principalType &&
      state.principalId === reference.principalId,
  );
  if (!hasReferencedPrincipal) {
    return "bundle principal does not match referenced principal";
  }

  if (
    !states.some(
      (state) =>
        state.principalType === reference.principalType &&
        state.principalId === reference.principalId &&
        state.version === reference.version &&
        state.keyEpoch === reference.keyEpoch &&
        state.stateHash === reference.stateHash &&
        state.keyFingerprint === reference.keyFingerprint,
    )
  ) {
    return "bundle chain does not contain referenced principal";
  }

  if (
    bundle.currentMemberEnvelopes.principalType !==
      bundle.currentState.principalType ||
    bundle.currentMemberEnvelopes.principalId !==
      bundle.currentState.principalId
  ) {
    return "member envelope principal does not match current principal";
  }

  if (
    bundle.currentMemberEnvelopes.stateHash !== bundle.currentState.stateHash
  ) {
    return "member envelope state hash does not match current principal";
  }

  if (bundle.currentMemberEnvelopes.epoch !== bundle.currentState.keyEpoch) {
    return "member envelope epoch does not match current principal";
  }

  if (
    bundle.currentPayload.principalType !== bundle.currentState.principalType ||
    bundle.currentPayload.principalId !== bundle.currentState.principalId
  ) {
    return "payload principal does not match current principal";
  }

  if (bundle.currentPayload.stateHash !== bundle.currentState.stateHash) {
    return "payload state hash does not match current principal";
  }

  return null;
}

function getPrincipalPolicyCheckpointMismatchReason(
  cachedBundle: PrincipalPolicyBundleResponse | null,
  bundle: PrincipalPolicyBundleResponse,
): string | null {
  if (!cachedBundle) {
    return null;
  }

  if (bundle.currentState.version < cachedBundle.currentState.version) {
    return "principal policy state is older than the local checkpoint";
  }

  if (
    bundle.currentState.version === cachedBundle.currentState.version &&
    bundle.currentState.stateHash !== cachedBundle.currentState.stateHash
  ) {
    return "principal policy state conflicts with the local checkpoint";
  }

  if (bundle.currentState.version === cachedBundle.currentState.version) {
    return null;
  }

  const stateChain = principalPolicyStates(bundle);
  const checkpointState = stateChain[cachedBundle.currentState.version - 1];
  if (
    !checkpointState ||
    checkpointState.stateHash !== cachedBundle.currentState.stateHash
  ) {
    return "principal policy chain does not extend the local checkpoint";
  }

  return null;
}

function signerPublicKeyLoadErrorMessage(
  code: PrincipalPolicySignerPublicKeyLoadErrorCode,
): string {
  switch (code) {
    case "fingerprint-invalid":
      return "computed signer key fingerprint does not match state signer";
    case "fingerprint-mismatch":
      return "signer key fingerprint does not match state signer";
    case "not-found":
      return "failed to fetch signer key";
    case "user-mismatch":
      return "signer key user does not match state signer";
  }
}

async function validatePrincipalPolicyBundle(
  reference: ReferencedPrincipalStateResponse,
  bundle: PrincipalPolicyBundleResponse,
  getEncapsulationKey: CacheReferencedPrincipalPoliciesOptions["getEncapsulationKey"],
  cachedBundle: PrincipalPolicyBundleResponse | null,
): Promise<string | null> {
  const referenceMismatch = getBundleReferenceMismatchReason(reference, bundle);
  if (referenceMismatch) {
    return referenceMismatch;
  }

  const checkpointMismatch = getPrincipalPolicyCheckpointMismatchReason(
    cachedBundle,
    bundle,
  );
  if (checkpointMismatch) {
    return checkpointMismatch;
  }

  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    getEncapsulationKey,
  });
  if ("error" in signerPublicKeys) {
    return signerPublicKeyLoadErrorMessage(signerPublicKeys.error);
  }

  const verified = await verifyPrincipalPolicyBundle({
    bundle: bundle as PrincipalPolicyBundle,
    expectedReference: reference,
    localCheckpoint: principalPolicyCheckpoint(cachedBundle),
    signerPublicKeys: signerPublicKeys.signerPublicKeys,
  });

  return verified.ok ? null : verified.error.message;
}

async function cacheReferencedPrincipalPolicy(
  execSql: ExecSql,
  getCurrentPrincipalPolicy: CacheReferencedPrincipalPoliciesOptions["getCurrentPrincipalPolicy"],
  getEncapsulationKey: CacheReferencedPrincipalPoliciesOptions["getEncapsulationKey"],
  reference: ReferencedPrincipalStateResponse,
  log: ((message: string) => void) | undefined,
): Promise<void> {
  const cachedBundle = await loadPrincipalPolicyBundle(
    execSql,
    reference.principalType,
    reference.principalId,
  );
  const cachedStateHash = cachedBundle?.currentState.stateHash ?? null;
  if (cachedStateHash === reference.stateHash) {
    return;
  }

  const bundle = await getCurrentPrincipalPolicy(
    reference.principalType,
    reference.principalId,
  );
  if (!bundle) {
    log?.(
      `Principal policy cache: failed to fetch ${getReferencedPrincipalKey(reference)}`,
    );
    return;
  }

  const validationError = await validatePrincipalPolicyBundle(
    reference,
    bundle,
    getEncapsulationKey,
    cachedBundle,
  );
  if (validationError) {
    log?.(
      `Principal policy cache: skipped ${getReferencedPrincipalKey(reference)}: ${validationError}`,
    );
    return;
  }

  await savePrincipalPolicyBundle(execSql, bundle, new Date().toISOString());
}

export async function cacheReferencedPrincipalPolicies({
  execSql,
  getEncapsulationKey,
  getCurrentPrincipalPolicy,
  log,
  references,
}: CacheReferencedPrincipalPoliciesOptions): Promise<void> {
  if (!references || references.length === 0) {
    return;
  }

  try {
    await ensurePrincipalPolicyTables(execSql);
    const uniqueReferences = dedupeReferencedPrincipals(references);

    await Promise.all(
      uniqueReferences.map(async (reference) => {
        try {
          await cacheReferencedPrincipalPolicy(
            execSql,
            getCurrentPrincipalPolicy,
            getEncapsulationKey,
            reference,
            log,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          log?.(
            `Principal policy cache: failed to store ${getReferencedPrincipalKey(reference)}: ${message}`,
          );
        }
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log?.(`Principal policy cache: failed to initialize cache: ${message}`);
  }
}

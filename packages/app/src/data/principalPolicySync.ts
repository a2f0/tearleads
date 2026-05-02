import {
  type PrincipalPolicyBundle,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "./persistence/principalPolicyPersistence";
import type { ExecSql } from "./persistence/sqlSchema";

interface CacheReferencedPrincipalPoliciesOptions {
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
  if (
    bundle.currentState.principalType !== reference.principalType ||
    bundle.currentState.principalId !== reference.principalId
  ) {
    return "bundle principal does not match referenced principal";
  }

  if (bundle.currentState.version !== reference.version) {
    return "bundle version does not match referenced principal";
  }

  if (bundle.currentState.keyEpoch !== reference.keyEpoch) {
    return "bundle key epoch does not match referenced principal";
  }

  if (bundle.currentState.stateHash !== reference.stateHash) {
    return "bundle state hash does not match referenced principal";
  }

  if (
    bundle.currentMemberEnvelopes.principalType !== reference.principalType ||
    bundle.currentMemberEnvelopes.principalId !== reference.principalId
  ) {
    return "member envelope principal does not match referenced principal";
  }

  if (bundle.currentMemberEnvelopes.stateHash !== reference.stateHash) {
    return "member envelope state hash does not match referenced principal";
  }

  if (bundle.currentMemberEnvelopes.epoch !== reference.keyEpoch) {
    return "member envelope epoch does not match referenced principal";
  }

  if (
    bundle.currentPayload.principalType !== reference.principalType ||
    bundle.currentPayload.principalId !== reference.principalId
  ) {
    return "payload principal does not match referenced principal";
  }

  if (bundle.currentPayload.stateHash !== reference.stateHash) {
    return "payload state hash does not match referenced principal";
  }

  return null;
}

function getPrincipalPolicyStates(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

async function loadVerifiedSignerPublicKey(input: {
  getEncapsulationKey: CacheReferencedPrincipalPoliciesOptions["getEncapsulationKey"];
  signerPublicKeysByFingerprint: Map<string, PrincipalPolicySignerPublicKey>;
  state: PrincipalPolicyBundleResponse["currentState"];
}): Promise<
  { signerPublicKey: PrincipalPolicySignerPublicKey } | { error: string }
> {
  const signerCacheKey = `${input.state.signerUserId}:${input.state.signerUserKeyFingerprint}`;
  const cachedSignerPublicKey =
    input.signerPublicKeysByFingerprint.get(signerCacheKey);
  if (cachedSignerPublicKey) {
    return { signerPublicKey: cachedSignerPublicKey };
  }

  const signerKey = await input.getEncapsulationKey(input.state.signerUserId);
  if (!signerKey) {
    return { error: "failed to fetch signer key" };
  }

  if (signerKey.userId !== input.state.signerUserId) {
    return { error: "signer key user does not match state signer" };
  }

  if (
    signerKey.signingKeyFingerprint !== input.state.signerUserKeyFingerprint
  ) {
    return { error: "signer key fingerprint does not match state signer" };
  }

  const signerPublicKey = base64ToBytes(signerKey.signingPublicKey);
  if (
    (await toFingerprint(signerPublicKey)) !==
    input.state.signerUserKeyFingerprint
  ) {
    return {
      error: "computed signer key fingerprint does not match state signer",
    };
  }

  const signerPublicKeyEntry = {
    userId: input.state.signerUserId,
    signingKeyFingerprint: input.state.signerUserKeyFingerprint,
    signingPublicKey: signerPublicKey,
  };
  input.signerPublicKeysByFingerprint.set(signerCacheKey, signerPublicKeyEntry);
  return { signerPublicKey: signerPublicKeyEntry };
}

async function collectPrincipalPolicySignerPublicKeys(
  bundle: PrincipalPolicyBundleResponse,
  getEncapsulationKey: CacheReferencedPrincipalPoliciesOptions["getEncapsulationKey"],
): Promise<
  { signerPublicKeys: PrincipalPolicySignerPublicKey[] } | { error: string }
> {
  const signerPublicKeysByFingerprint = new Map<
    string,
    PrincipalPolicySignerPublicKey
  >();

  for (const state of getPrincipalPolicyStates(bundle)) {
    const loadedSignerPublicKey = await loadVerifiedSignerPublicKey({
      getEncapsulationKey,
      signerPublicKeysByFingerprint,
      state,
    });
    if ("error" in loadedSignerPublicKey) {
      return { error: loadedSignerPublicKey.error };
    }
  }

  return {
    signerPublicKeys: Array.from(signerPublicKeysByFingerprint.values()),
  };
}

function principalPolicyCheckpoint(
  cachedBundle: PrincipalPolicyBundleResponse | null,
): PrincipalPolicyCheckpoint | null {
  return cachedBundle
    ? {
        principalType: cachedBundle.currentState.principalType,
        principalId: cachedBundle.currentState.principalId,
        version: cachedBundle.currentState.version,
        stateHash: cachedBundle.currentState.stateHash,
      }
    : null;
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

  const stateChain = getPrincipalPolicyStates(bundle);
  const checkpointState = stateChain[cachedBundle.currentState.version - 1];
  if (
    !checkpointState ||
    checkpointState.stateHash !== cachedBundle.currentState.stateHash
  ) {
    return "principal policy chain does not extend the local checkpoint";
  }

  return null;
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

  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys(
    bundle,
    getEncapsulationKey,
  );
  if ("error" in signerPublicKeys) {
    return signerPublicKeys.error;
  }

  const verified = await verifyPrincipalPolicyBundle({
    bundle: bundle as PrincipalPolicyBundle,
    expectedReference: {
      ...reference,
      keyFingerprint: bundle.currentState.keyFingerprint,
    },
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

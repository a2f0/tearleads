import {
  computePrincipalProjectionRoot,
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
  toFingerprint,
  verifySignedPrincipalState,
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

function projectionIncludesAdminUser(
  projection: PrincipalPolicyBundleResponse["currentProjection"],
  userId: string,
): boolean {
  return projection.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === userId &&
      member.role === "admin",
  );
}

async function getBundlePayloadMismatchReason(
  bundle: PrincipalPolicyBundleResponse,
): Promise<string | null> {
  const computedPayloadCiphertextHash =
    await computePrincipalStatePayloadCiphertextHash(
      bundle.currentPayload.ciphertext,
    );
  if (computedPayloadCiphertextHash !== bundle.currentPayload.ciphertextHash) {
    return "computed payload hash does not match bundle payload hash";
  }

  if (
    bundle.currentPayload.ciphertextHash !==
    bundle.currentState.payloadCiphertextHash
  ) {
    return "bundle payload hash does not match current state payload hash";
  }

  return null;
}

interface PrincipalPolicyStateChainEntry {
  state: PrincipalPolicyBundleResponse["currentState"];
  projection: PrincipalPolicyBundleResponse["currentProjection"];
}

function getPrincipalPolicyStateChain(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyStateChainEntry[] {
  return [
    ...bundle.previousStates,
    {
      state: bundle.currentState,
      projection: bundle.currentProjection,
    },
  ];
}

async function loadVerifiedSignerPublicKey(input: {
  getEncapsulationKey: CacheReferencedPrincipalPoliciesOptions["getEncapsulationKey"];
  signerPublicKeysByFingerprint: Map<string, Uint8Array>;
  state: PrincipalPolicyStateChainEntry["state"];
}): Promise<{ publicKey: Uint8Array } | { error: string }> {
  const signerCacheKey = `${input.state.signerUserId}:${input.state.signerUserKeyFingerprint}`;
  const cachedPublicKey =
    input.signerPublicKeysByFingerprint.get(signerCacheKey);
  if (cachedPublicKey) {
    return { publicKey: cachedPublicKey };
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

  input.signerPublicKeysByFingerprint.set(signerCacheKey, signerPublicKey);
  return { publicKey: signerPublicKey };
}

async function getPrincipalPolicyChainEntryMismatchReason(input: {
  bundle: PrincipalPolicyBundleResponse;
  entry: PrincipalPolicyStateChainEntry;
  expectedVersion: number;
  getEncapsulationKey: CacheReferencedPrincipalPoliciesOptions["getEncapsulationKey"];
  previousEntry: PrincipalPolicyStateChainEntry | null;
  signerPublicKeysByFingerprint: Map<string, Uint8Array>;
}): Promise<string | null> {
  if (
    input.entry.state.principalType !==
      input.bundle.currentState.principalType ||
    input.entry.state.principalId !== input.bundle.currentState.principalId
  ) {
    return "principal policy chain entry principal does not match current state";
  }

  if (input.entry.state.version !== input.expectedVersion) {
    return "principal policy chain entry version is not contiguous";
  }

  const computedStateHash = await computePrincipalStateHash(input.entry.state);
  if (computedStateHash !== input.entry.state.stateHash) {
    return "computed state hash does not match chain entry state hash";
  }

  const computedProjectionRoot = await computePrincipalProjectionRoot(
    input.entry.projection,
  );
  if (computedProjectionRoot !== input.entry.state.projectionRoot) {
    return "computed projection root does not match chain entry state projection root";
  }

  if (input.entry.projection.length !== input.entry.state.memberCount) {
    return "chain entry projection count does not match state member count";
  }

  if (input.previousEntry) {
    if (
      input.entry.state.prevStateHash !== input.previousEntry.state.stateHash
    ) {
      return "principal policy chain entry previous hash mismatch";
    }

    if (
      !projectionIncludesAdminUser(
        input.previousEntry.projection,
        input.entry.state.signerUserId,
      )
    ) {
      return "state signer is not an admin in previous projection";
    }
  } else if (input.entry.state.prevStateHash !== null) {
    return "initial principal policy chain entry has a previous state hash";
  } else if (
    !projectionIncludesAdminUser(
      input.entry.projection,
      input.entry.state.signerUserId,
    )
  ) {
    return "initial state signer is not an admin in current projection";
  }

  const signerPublicKey = await loadVerifiedSignerPublicKey({
    getEncapsulationKey: input.getEncapsulationKey,
    signerPublicKeysByFingerprint: input.signerPublicKeysByFingerprint,
    state: input.entry.state,
  });
  if ("error" in signerPublicKey) {
    return signerPublicKey.error;
  }

  const signatureVerified = await verifySignedPrincipalState(
    input.entry.state,
    signerPublicKey.publicKey,
  );
  if (!signatureVerified) {
    return "principal state signature verification failed";
  }

  return null;
}

async function getPrincipalPolicyChainMismatchReason(
  bundle: PrincipalPolicyBundleResponse,
  getEncapsulationKey: CacheReferencedPrincipalPoliciesOptions["getEncapsulationKey"],
): Promise<string | null> {
  const stateChain = getPrincipalPolicyStateChain(bundle);
  if (stateChain.length !== bundle.currentState.version) {
    return "principal policy chain length does not match current state version";
  }

  const signerPublicKeysByFingerprint = new Map<string, Uint8Array>();
  let previousEntry: PrincipalPolicyStateChainEntry | null = null;

  for (let index = 0; index < stateChain.length; index += 1) {
    const entry = stateChain[index];
    if (!entry) {
      return "principal policy chain entry is missing";
    }

    const mismatch = await getPrincipalPolicyChainEntryMismatchReason({
      bundle,
      entry,
      expectedVersion: index + 1,
      getEncapsulationKey,
      previousEntry,
      signerPublicKeysByFingerprint,
    });
    if (mismatch) {
      return mismatch;
    }

    previousEntry = entry;
  }

  return null;
}

async function validatePrincipalPolicyBundle(
  reference: ReferencedPrincipalStateResponse,
  bundle: PrincipalPolicyBundleResponse,
  getEncapsulationKey: CacheReferencedPrincipalPoliciesOptions["getEncapsulationKey"],
): Promise<string | null> {
  const referenceMismatch = getBundleReferenceMismatchReason(reference, bundle);
  if (referenceMismatch) {
    return referenceMismatch;
  }

  const payloadMismatch = await getBundlePayloadMismatchReason(bundle);
  if (payloadMismatch) {
    return payloadMismatch;
  }

  return getPrincipalPolicyChainMismatchReason(bundle, getEncapsulationKey);
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

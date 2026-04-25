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

async function getBundleSignatureMismatchReason(
  bundle: PrincipalPolicyBundleResponse,
  signerKey: EncapsulationKeyResponse,
  previousBundle: PrincipalPolicyBundleResponse | null,
): Promise<string | null> {
  if (signerKey.userId !== bundle.currentState.signerUserId) {
    return "signer key user does not match current state signer";
  }

  if (
    signerKey.signingKeyFingerprint !==
    bundle.currentState.signerUserKeyFingerprint
  ) {
    return "signer key fingerprint does not match current state signer";
  }

  const signerPublicKey = base64ToBytes(signerKey.signingPublicKey);
  if (
    (await toFingerprint(signerPublicKey)) !==
    bundle.currentState.signerUserKeyFingerprint
  ) {
    return "computed signer key fingerprint does not match current state signer";
  }

  const computedStateHash = await computePrincipalStateHash(
    bundle.currentState,
  );
  if (computedStateHash !== bundle.currentState.stateHash) {
    return "computed state hash does not match bundle state hash";
  }

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

  const computedProjectionRoot = await computePrincipalProjectionRoot(
    bundle.currentProjection,
  );
  if (computedProjectionRoot !== bundle.currentState.projectionRoot) {
    return "computed projection root does not match current state projection root";
  }

  if (bundle.currentProjection.length !== bundle.currentState.memberCount) {
    return "bundle projection count does not match current state member count";
  }

  if (bundle.currentState.prevStateHash === null) {
    if (
      !projectionIncludesAdminUser(
        bundle.currentProjection,
        bundle.currentState.signerUserId,
      )
    ) {
      return "initial state signer is not an admin in current projection";
    }
  } else {
    if (!previousBundle) {
      return "previous principal policy state is not cached";
    }
    if (
      previousBundle.currentState.stateHash !==
      bundle.currentState.prevStateHash
    ) {
      return "cached previous principal policy state does not match current state";
    }
    if (
      !projectionIncludesAdminUser(
        previousBundle.currentProjection,
        bundle.currentState.signerUserId,
      )
    ) {
      return "state signer is not an admin in previous projection";
    }
  }

  const signatureVerified = await verifySignedPrincipalState(
    bundle.currentState,
    signerPublicKey,
  );
  if (!signatureVerified) {
    return "principal state signature verification failed";
  }

  return null;
}

async function validatePrincipalPolicyBundle(
  reference: ReferencedPrincipalStateResponse,
  bundle: PrincipalPolicyBundleResponse,
  signerKey: EncapsulationKeyResponse,
  previousBundle: PrincipalPolicyBundleResponse | null,
): Promise<string | null> {
  const referenceMismatch = getBundleReferenceMismatchReason(reference, bundle);
  if (referenceMismatch) {
    return referenceMismatch;
  }

  return getBundleSignatureMismatchReason(bundle, signerKey, previousBundle);
}

async function cacheReferencedPrincipalPolicy(
  execSql: ExecSql,
  getCurrentPrincipalPolicy: CacheReferencedPrincipalPoliciesOptions["getCurrentPrincipalPolicy"],
  getEncapsulationKey: CacheReferencedPrincipalPoliciesOptions["getEncapsulationKey"],
  reference: ReferencedPrincipalStateResponse,
  log: ((message: string) => void) | undefined,
): Promise<void> {
  const previousBundle = await loadPrincipalPolicyBundle(
    execSql,
    reference.principalType,
    reference.principalId,
  );
  const cachedStateHash = previousBundle?.currentState.stateHash ?? null;
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

  const signerKey = await getEncapsulationKey(bundle.currentState.signerUserId);
  if (!signerKey) {
    log?.(
      `Principal policy cache: skipped ${getReferencedPrincipalKey(reference)}: failed to fetch signer key`,
    );
    return;
  }

  const validationError = await validatePrincipalPolicyBundle(
    reference,
    bundle,
    signerKey,
    previousBundle,
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

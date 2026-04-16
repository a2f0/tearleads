import {
  computePrincipalStateHash,
  verifySignedPrincipalState,
} from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyStateHash,
  savePrincipalPolicyBundle,
} from "./persistence/principalPolicyPersistence";
import type { ExecSql } from "./persistence/sqlSchema";

interface CacheReferencedPrincipalPoliciesOptions {
  execSql: ExecSql;
  getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  log?: (message: string) => void;
  references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined;
  trustedPolicySigners: ReadonlyMap<string, Uint8Array>;
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

  return null;
}

async function getBundleSignatureMismatchReason(
  bundle: PrincipalPolicyBundleResponse,
  trustedPolicySigners: ReadonlyMap<string, Uint8Array>,
): Promise<string | null> {
  const trustedSignerPublicKey = trustedPolicySigners.get(
    bundle.currentState.signerKeyId,
  );

  if (!trustedSignerPublicKey) {
    return `untrusted signer ${bundle.currentState.signerKeyId}`;
  }

  const computedStateHash = await computePrincipalStateHash(
    bundle.currentState,
  );
  if (computedStateHash !== bundle.currentState.stateHash) {
    return "computed state hash does not match bundle state hash";
  }

  const signatureVerified = await verifySignedPrincipalState(
    bundle.currentState,
    trustedSignerPublicKey,
  );
  if (!signatureVerified) {
    return "principal state signature verification failed";
  }

  return null;
}

async function validatePrincipalPolicyBundle(
  reference: ReferencedPrincipalStateResponse,
  bundle: PrincipalPolicyBundleResponse,
  trustedPolicySigners: ReadonlyMap<string, Uint8Array>,
): Promise<string | null> {
  const referenceMismatch = getBundleReferenceMismatchReason(reference, bundle);
  if (referenceMismatch) {
    return referenceMismatch;
  }

  return getBundleSignatureMismatchReason(bundle, trustedPolicySigners);
}

async function cacheReferencedPrincipalPolicy(
  execSql: ExecSql,
  getCurrentPrincipalPolicy: CacheReferencedPrincipalPoliciesOptions["getCurrentPrincipalPolicy"],
  trustedPolicySigners: ReadonlyMap<string, Uint8Array>,
  reference: ReferencedPrincipalStateResponse,
  log: ((message: string) => void) | undefined,
): Promise<void> {
  const cachedStateHash = await loadPrincipalPolicyStateHash(
    execSql,
    reference.principalType,
    reference.principalId,
  );
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
    trustedPolicySigners,
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
  getCurrentPrincipalPolicy,
  log,
  references,
  trustedPolicySigners,
}: CacheReferencedPrincipalPoliciesOptions): Promise<void> {
  if (
    !references ||
    references.length === 0 ||
    trustedPolicySigners.size === 0
  ) {
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
            trustedPolicySigners,
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

import type {
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import { errorMessage } from "../../data/errorMessage";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { dedupeReferencedPrincipalStates } from "../../data/keyingProjectionVerification/principalPolicyCache";
import { persistVerifiedPrincipalPolicyBundlesAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyVerificationCheckpoint } from "../../data/persistence/principalPolicyCheckpointSelection";
import { ensurePrincipalPolicyTables } from "../../data/persistence/principalPolicyPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../data/persistence/principalPolicyReferencePersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  externalAdminPolicyPersistenceEntries,
  loadOrganizationExternalAdminPolicy,
  type VerifiedExternalAdminPolicy,
} from "./externalAdminPolicy";
import { validatePrincipalPolicyBundleForCache } from "./principalPolicyCacheValidation";

export interface CacheReferencedPrincipalPoliciesOptions {
  execSql: ExecSql;
  getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  log?: (message: string) => void;
  organizationId?: string | null | undefined;
  references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export interface CachePrincipalPolicyBundlesOptions
  extends Omit<CacheReferencedPrincipalPoliciesOptions, "references"> {
  bundles: ReadonlyArray<PrincipalPolicyBundleResponse> | undefined;
}

function getReferencedPrincipalKey(
  reference: ReferencedPrincipalStateResponse,
): string {
  return `${reference.principalType}:${reference.principalId}`;
}

function getBundlePrincipalKey(bundle: PrincipalPolicyBundleResponse): string {
  return `${bundle.currentState.principalType}:${bundle.currentState.principalId}`;
}

function referenceFromPrincipalPolicyBundle(
  bundle: PrincipalPolicyBundleResponse,
): ReferencedPrincipalStateResponse {
  return {
    principalType: bundle.currentState.principalType,
    principalId: bundle.currentState.principalId,
    version: bundle.currentState.version,
    keyEpoch: bundle.currentState.keyEpoch,
    stateHash: bundle.currentState.stateHash,
    keyFingerprint: bundle.currentState.keyFingerprint,
  };
}

function dedupePrincipalPolicyBundles(
  bundles: ReadonlyArray<PrincipalPolicyBundleResponse>,
): PrincipalPolicyBundleResponse[] {
  const bundlesByPrincipal = new Map<string, PrincipalPolicyBundleResponse>();

  for (const bundle of bundles) {
    const key = getBundlePrincipalKey(bundle);
    const previous = bundlesByPrincipal.get(key);
    if (
      !previous ||
      bundle.currentState.version > previous.currentState.version
    ) {
      bundlesByPrincipal.set(key, bundle);
    }
  }

  return Array.from(bundlesByPrincipal.values());
}

async function cacheReferencedPrincipalPolicy(
  execSql: ExecSql,
  getCurrentPrincipalPolicy: CacheReferencedPrincipalPoliciesOptions["getCurrentPrincipalPolicy"],
  reference: ReferencedPrincipalStateResponse,
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
  log: ((message: string) => void) | undefined,
  loadExternalAdminPolicy: () => Promise<VerifiedExternalAdminPolicy | null>,
): Promise<void> {
  const localCheckpoint = await loadPrincipalPolicyVerificationCheckpoint({
    execSql,
    principalId: reference.principalId,
    principalType: reference.principalType,
  });
  // Only null is a recoverable local miss. Integrity failures remain typed and
  // must escape rather than being hidden by a canonical network retry.
  const cachedBundle = await loadPrincipalPolicyBundleForReference(
    execSql,
    reference,
    localCheckpoint,
  );
  const bundle =
    cachedBundle ??
    (await getCurrentPrincipalPolicy(
      reference.principalType,
      reference.principalId,
    ));
  if (!bundle) {
    log?.(
      `Principal policy cache: failed to fetch ${getReferencedPrincipalKey(reference)}`,
    );
    return;
  }

  const validation = await validatePrincipalPolicyBundleForCache({
    bundle,
    loadExternalAdminPolicy,
    localCheckpoint,
    reference,
    resolveTrustedUserIdentity,
  });
  if (!validation.ok) {
    throw validation.error;
  }

  await persistVerifiedPrincipalPolicyBundlesAtomically({
    entries: [
      ...(validation.externalAdminPolicy
        ? externalAdminPolicyPersistenceEntries(validation.externalAdminPolicy)
        : []),
      { bundle, policy: validation.policy },
    ],
    execSql,
    updatedAt: new Date().toISOString(),
  });
}

async function cachePrincipalPolicyBundle(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly loadExternalAdminPolicy: () => Promise<VerifiedExternalAdminPolicy | null>;
  readonly log: ((message: string) => void) | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<void> {
  const reference = referenceFromPrincipalPolicyBundle(input.bundle);
  // The API supplied this bundle after rejecting a write, but local storage is
  // only updated after normal signature, signer, and checkpoint verification.
  const localCheckpoint = await loadPrincipalPolicyVerificationCheckpoint({
    execSql: input.execSql,
    principalId: reference.principalId,
    principalType: reference.principalType,
  });
  const validation = await validatePrincipalPolicyBundleForCache({
    bundle: input.bundle,
    loadExternalAdminPolicy: input.loadExternalAdminPolicy,
    localCheckpoint,
    reference,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if (!validation.ok) {
    throw validation.error;
  }

  await persistVerifiedPrincipalPolicyBundlesAtomically({
    entries: [
      ...(validation.externalAdminPolicy
        ? externalAdminPolicyPersistenceEntries(validation.externalAdminPolicy)
        : []),
      { bundle: input.bundle, policy: validation.policy },
    ],
    execSql: input.execSql,
    updatedAt: new Date().toISOString(),
  });
}

export async function cacheReferencedPrincipalPolicies({
  execSql,
  getCurrentPrincipalPolicy,
  log,
  organizationId,
  references,
  resolveTrustedUserIdentity,
}: CacheReferencedPrincipalPoliciesOptions): Promise<void> {
  if (!references || references.length === 0) {
    return;
  }

  try {
    await ensurePrincipalPolicyTables(execSql);
    const uniqueReferences = dedupeReferencedPrincipalStates(references);
    let externalAdminPolicy: Promise<VerifiedExternalAdminPolicy | null> | null =
      null;
    const loadExternalAdminPolicy = () => {
      externalAdminPolicy ??= loadOrganizationExternalAdminPolicy({
        execSql,
        getCurrentPrincipalPolicy,
        organizationId,
        resolveTrustedUserIdentity,
      });
      return externalAdminPolicy;
    };

    await Promise.all(
      uniqueReferences.map(async (reference) => {
        try {
          await cacheReferencedPrincipalPolicy(
            execSql,
            getCurrentPrincipalPolicy,
            reference,
            resolveTrustedUserIdentity,
            log,
            loadExternalAdminPolicy,
          );
        } catch (error) {
          rethrowKeyingVerificationError(error);
          const message = errorMessage(error);
          log?.(
            `Principal policy cache: failed to store ${getReferencedPrincipalKey(reference)}: ${message}`,
          );
        }
      }),
    );
  } catch (error) {
    rethrowKeyingVerificationError(error);
    const message = errorMessage(error);
    log?.(`Principal policy cache: failed to initialize cache: ${message}`);
  }
}

export async function cachePrincipalPolicyBundles({
  bundles,
  execSql,
  getCurrentPrincipalPolicy,
  log,
  organizationId,
  resolveTrustedUserIdentity,
}: CachePrincipalPolicyBundlesOptions): Promise<void> {
  if (!bundles || bundles.length === 0) {
    return;
  }

  try {
    await ensurePrincipalPolicyTables(execSql);
    const uniqueBundles = dedupePrincipalPolicyBundles(bundles);
    let externalAdminPolicy: Promise<VerifiedExternalAdminPolicy | null> | null =
      null;
    const loadExternalAdminPolicy = () => {
      externalAdminPolicy ??= loadOrganizationExternalAdminPolicy({
        execSql,
        getCurrentPrincipalPolicy,
        organizationId,
        resolveTrustedUserIdentity,
      });
      return externalAdminPolicy;
    };

    await Promise.all(
      uniqueBundles.map(async (bundle) => {
        try {
          await cachePrincipalPolicyBundle({
            bundle,
            execSql,
            loadExternalAdminPolicy,
            log,
            resolveTrustedUserIdentity,
          });
        } catch (error) {
          rethrowKeyingVerificationError(error);
          const message = errorMessage(error);
          log?.(
            `Principal policy cache: failed to store ${getBundlePrincipalKey(bundle)}: ${message}`,
          );
        }
      }),
    );
  } catch (error) {
    rethrowKeyingVerificationError(error);
    const message = errorMessage(error);
    log?.(`Principal policy cache: failed to initialize cache: ${message}`);
  }
}

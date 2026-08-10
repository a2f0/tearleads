import type {
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import { errorMessage } from "../../data/errorMessage";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { dedupeReferencedPrincipalStates } from "../../data/keyingProjectionVerification/principalPolicyCache";
import { persistVerifiedPrincipalPolicyBundlesAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { ensurePrincipalPolicyTables } from "../../data/persistence/principalPolicyPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../data/persistence/principalPolicyReferencePersistence";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
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
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    execSql,
    reference.principalType,
    reference.principalId,
  );
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
  const reference = principalPolicyReferenceFromBundle(input.bundle);
  // The API supplied this bundle after rejecting a write, but local storage is
  // only updated after normal signature, signer, and checkpoint verification.
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    reference.principalType,
    reference.principalId,
  );
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

async function runPrincipalPolicyCache<Item>(input: {
  readonly cacheItem: (
    item: Item,
    loadExternalAdminPolicy: () => Promise<VerifiedExternalAdminPolicy | null>,
  ) => Promise<void>;
  readonly dedupe: (items: ReadonlyArray<Item>) => Item[];
  readonly execSql: ExecSql;
  readonly getCurrentPrincipalPolicy: CacheReferencedPrincipalPoliciesOptions["getCurrentPrincipalPolicy"];
  readonly itemKey: (item: Item) => string;
  readonly items: ReadonlyArray<Item> | undefined;
  readonly log: ((message: string) => void) | undefined;
  readonly organizationId: string | null | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<void> {
  if (!input.items || input.items.length === 0) {
    return;
  }

  try {
    await ensurePrincipalPolicyTables(input.execSql);
    const uniqueItems = input.dedupe(input.items);
    let externalAdminPolicy: Promise<VerifiedExternalAdminPolicy | null> | null =
      null;
    const loadExternalAdminPolicy = () => {
      externalAdminPolicy ??= loadOrganizationExternalAdminPolicy({
        execSql: input.execSql,
        getCurrentPrincipalPolicy: input.getCurrentPrincipalPolicy,
        organizationId: input.organizationId,
        resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
      });
      return externalAdminPolicy;
    };

    await Promise.all(
      uniqueItems.map(async (item) => {
        try {
          await input.cacheItem(item, loadExternalAdminPolicy);
        } catch (error) {
          rethrowKeyingVerificationError(error);
          const message = errorMessage(error);
          input.log?.(
            `Principal policy cache: failed to store ${input.itemKey(item)}: ${message}`,
          );
        }
      }),
    );
  } catch (error) {
    rethrowKeyingVerificationError(error);
    const message = errorMessage(error);
    input.log?.(
      `Principal policy cache: failed to initialize cache: ${message}`,
    );
  }
}

export async function cacheReferencedPrincipalPolicies({
  execSql,
  getCurrentPrincipalPolicy,
  log,
  organizationId,
  references,
  resolveTrustedUserIdentity,
}: CacheReferencedPrincipalPoliciesOptions): Promise<void> {
  return runPrincipalPolicyCache({
    cacheItem: (reference, loadExternalAdminPolicy) =>
      cacheReferencedPrincipalPolicy(
        execSql,
        getCurrentPrincipalPolicy,
        reference,
        resolveTrustedUserIdentity,
        log,
        loadExternalAdminPolicy,
      ),
    dedupe: dedupeReferencedPrincipalStates,
    execSql,
    getCurrentPrincipalPolicy,
    itemKey: getReferencedPrincipalKey,
    items: references,
    log,
    organizationId,
    resolveTrustedUserIdentity,
  });
}

export async function cachePrincipalPolicyBundles({
  bundles,
  execSql,
  getCurrentPrincipalPolicy,
  log,
  organizationId,
  resolveTrustedUserIdentity,
}: CachePrincipalPolicyBundlesOptions): Promise<void> {
  return runPrincipalPolicyCache({
    cacheItem: (bundle, loadExternalAdminPolicy) =>
      cachePrincipalPolicyBundle({
        bundle,
        execSql,
        loadExternalAdminPolicy,
        log,
        resolveTrustedUserIdentity,
      }),
    dedupe: dedupePrincipalPolicyBundles,
    execSql,
    getCurrentPrincipalPolicy,
    itemKey: getBundlePrincipalKey,
    items: bundles,
    log,
    organizationId,
    resolveTrustedUserIdentity,
  });
}

import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import { isProjectionVerificationCancelledError } from "../../data/keyingProjectionVerification";
import {
  reportAndRethrowKeyingVerificationError,
  rethrowKeyingVerificationError,
} from "../../data/keyingProjectionVerification/error";
import { dedupeReferencedPrincipalStates } from "../../data/keyingProjectionVerification/principalPolicyCache";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { ensurePrincipalPolicyTables } from "../../data/persistence/principalPolicyPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../data/persistence/principalPolicyReferencePersistence";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import { errorMessage } from "../../data/shared/errorMessage";
import type { SecurityIncidentReporter } from "../../data/shared/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import type { CurrentPrincipalPolicyReader } from "./currentPrincipalPolicyReader";
import {
  externalAdminPolicyPersistenceEntries,
  loadOrganizationExternalAdminPolicy,
  type VerifiedExternalAdminPolicy,
} from "./externalAdminPolicy";
import {
  persistPrincipalPolicyCacheEntries,
  retryPrincipalPolicyCacheAdvance,
} from "./principalPolicyCacheAdvance";
import { scopeReferencedPolicyForCache } from "./principalPolicyCacheScope";
import { validatePrincipalPolicyBundleForCache } from "./principalPolicyCacheValidation";
import {
  createPolicyDirectoryLoader,
  directoryBindsGroupReference,
  type PolicyDirectoryLoader,
  type VerifiedPolicyDirectory,
} from "./principalPolicyOrganizationScope";

export interface CacheReferencedPrincipalPoliciesOptions {
  currentPolicyReader: CurrentPrincipalPolicyReader;
  execSql: ExecSql;
  log?: (message: string) => void;
  organizationId: string;
  reportSecurityIncident: SecurityIncidentReporter;
  references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  stillCurrent?: (() => boolean) | undefined;
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
  reader: CurrentPrincipalPolicyReader,
  reference: ReferencedPrincipalStateResponse,
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
  log: ((message: string) => void) | undefined,
  loadExternalAdminPolicy: () => Promise<VerifiedExternalAdminPolicy | null>,
  organizationId: string,
  stillCurrent: (() => boolean) | undefined,
  loadDirectory: PolicyDirectoryLoader,
  fresh: boolean,
): Promise<VerifiedPrincipalPolicy[]> {
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    execSql,
    reference.principalType,
    reference.principalId,
  );
  // Only null is a recoverable local miss. Integrity failures remain typed and
  // must escape rather than being hidden by a canonical network retry.
  const cachedBundle = fresh
    ? null
    : await loadPrincipalPolicyBundleForReference(
        execSql,
        reference,
        localCheckpoint,
      );
  let bundle =
    cachedBundle ??
    (await reader.getCurrentPrincipalPolicy(
      reference.principalType,
      reference.principalId,
    ));
  if (!bundle) {
    log?.(
      `Principal policy cache: failed to fetch ${getReferencedPrincipalKey(reference)}`,
    );
    return [];
  }

  let validation = await validatePrincipalPolicyBundleForCache({
    bundle,
    loadExternalAdminPolicy,
    localCheckpoint,
    reference,
    resolveTrustedUserIdentity,
  });
  if (!validation.ok) {
    throw validation.error;
  }

  const scoped = await scopeReferencedPolicyForCache({
    bundle,
    validation,
    validationInput: {
      loadExternalAdminPolicy,
      localCheckpoint,
      reference,
      resolveTrustedUserIdentity,
    },
    loadDirectory,
    organizationId,
    reloadBundle: cachedBundle
      ? () => reader.getCurrentPrincipalPolicy("group", reference.principalId)
      : null,
  });
  if (!scoped) {
    log?.(
      `Principal policy cache: signed organization directory does not cover ${getReferencedPrincipalKey(reference)}`,
    );
    return [];
  }
  bundle = scoped.bundle;
  validation = scoped.validation;
  const directory = scoped.directory;
  const externalEntries = validation.externalAdminPolicy
    ? externalAdminPolicyPersistenceEntries(
        validation.externalAdminPolicy,
      ).filter(
        (entry) => !directory || entry.policy.principalType !== "organization",
      )
    : [];
  const directoryEntries = directory
    ? [{ bundle: directory.bundle, policy: directory.policy }]
    : [];
  await persistPrincipalPolicyCacheEntries({
    entries: [
      ...externalEntries,
      ...directoryEntries,
      { bundle, policy: validation.policy },
    ],
    execSql,
    organizationId,
    updatedAt: new Date().toISOString(),
    stillCurrent,
  });
  return [...externalEntries.map(({ policy }) => policy), validation.policy];
}

async function cachePrincipalPolicyBundle(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly loadExternalAdminPolicy: () => Promise<VerifiedExternalAdminPolicy | null>;
  readonly log: ((message: string) => void) | undefined;
  readonly loadDirectory: PolicyDirectoryLoader;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
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

  let directory: VerifiedPolicyDirectory | null = null;
  if (reference.principalType === "group") {
    directory = await input.loadDirectory(false);
    if (!directoryBindsGroupReference(directory, validation.policy, reference))
      directory = await input.loadDirectory(true);
    if (
      !directoryBindsGroupReference(directory, validation.policy, reference)
    ) {
      input.log?.(
        "Principal policy cache: signed organization directory does not cover supplied group",
      );
      return [];
    }
  } else if (reference.principalId !== input.organizationId) {
    return [];
  }
  const externalEntries = validation.externalAdminPolicy
    ? externalAdminPolicyPersistenceEntries(
        validation.externalAdminPolicy,
      ).filter(
        (entry) => !directory || entry.policy.principalType !== "organization",
      )
    : [];
  const directoryEntries = directory
    ? [{ bundle: directory.bundle, policy: directory.policy }]
    : [];
  await persistPrincipalPolicyCacheEntries({
    entries: [
      ...externalEntries,
      ...directoryEntries,
      { bundle: input.bundle, policy: validation.policy },
    ],
    execSql: input.execSql,
    organizationId: input.organizationId,
    updatedAt: new Date().toISOString(),
    stillCurrent: input.stillCurrent,
  });
  return [...externalEntries.map(({ policy }) => policy), validation.policy];
}

async function runPrincipalPolicyCache<Item, Result>(input: {
  readonly cacheItem: (
    item: Item,
    loadExternalAdminPolicy: () => Promise<VerifiedExternalAdminPolicy | null>,
    loadDirectory: PolicyDirectoryLoader,
    fresh: boolean,
  ) => Promise<readonly Result[]>;
  readonly currentPolicyReader: CurrentPrincipalPolicyReader;
  readonly dedupe: (items: ReadonlyArray<Item>) => Item[];
  readonly execSql: ExecSql;
  readonly itemKey: (item: Item) => string;
  readonly items: ReadonlyArray<Item> | undefined;
  readonly log: ((message: string) => void) | undefined;
  readonly organizationId: string;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<Result[]> {
  if (!input.items || input.items.length === 0) {
    return [];
  }

  try {
    await ensurePrincipalPolicyTables(input.execSql);
    const uniqueItems = input.dedupe(input.items);
    const loadDirectory = createPolicyDirectoryLoader(input);
    let externalAdminPolicy: Promise<VerifiedExternalAdminPolicy | null> | null =
      null;
    const loadExternalAdminPolicy = () => {
      externalAdminPolicy ??= loadOrganizationExternalAdminPolicy({
        currentPolicyReader: input.currentPolicyReader,
        execSql: input.execSql,
        organizationId: input.organizationId,

        resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
        stillCurrent: input.stillCurrent,
      });
      return externalAdminPolicy;
    };

    const results = await Promise.all(
      uniqueItems.map(async (item) => {
        try {
          return await retryPrincipalPolicyCacheAdvance((fresh) => {
            const reloadDirectory = createPolicyDirectoryLoader(input);
            let reloadedAuthority: Promise<VerifiedExternalAdminPolicy | null> | null =
              null;
            return input.cacheItem(
              item,
              fresh
                ? () =>
                    (reloadedAuthority ??=
                      loadOrganizationExternalAdminPolicy(input))
                : loadExternalAdminPolicy,
              fresh ? () => reloadDirectory(true) : loadDirectory,
              fresh,
            );
          });
        } catch (error) {
          if (isProjectionVerificationCancelledError(error)) return [];
          await reportAndRethrowKeyingVerificationError(
            error,
            input.reportSecurityIncident,
            {
              objectId: input.itemKey(item),
              objectKind: "principal",
              operation: "principal.policy.cache",
              organizationId: input.organizationId,
            },
          );
          const message = errorMessage(error);
          input.log?.(
            `Principal policy cache: failed to store ${input.itemKey(item)}: ${message}`,
          );
          return [];
        }
      }),
    );
    return results.flat();
  } catch (error) {
    if (isProjectionVerificationCancelledError(error)) return [];
    // Per-item verification failures were reported above before reaching this
    // initialization/aggregation boundary.
    rethrowKeyingVerificationError(error);
    const message = errorMessage(error);
    input.log?.(
      `Principal policy cache: failed to initialize cache: ${message}`,
    );
    return [];
  }
}

async function loadReferencedPrincipalPolicies({
  currentPolicyReader,
  execSql,
  log,
  organizationId,
  reportSecurityIncident,
  references,
  resolveTrustedUserIdentity,
  stillCurrent,
}: CacheReferencedPrincipalPoliciesOptions): Promise<
  VerifiedPrincipalPolicy[]
> {
  return runPrincipalPolicyCache({
    cacheItem: (reference, loadExternalAdminPolicy, loadDirectory, fresh) =>
      cacheReferencedPrincipalPolicy(
        execSql,
        currentPolicyReader,
        reference,
        resolveTrustedUserIdentity,
        log,
        loadExternalAdminPolicy,
        organizationId,
        stillCurrent,
        loadDirectory,
        fresh,
      ),
    currentPolicyReader,
    dedupe: dedupeReferencedPrincipalStates,
    execSql,
    itemKey: getReferencedPrincipalKey,
    items: references,
    log,
    organizationId,

    reportSecurityIncident,
    resolveTrustedUserIdentity,
    stillCurrent,
  });
}

export async function cacheReferencedPrincipalPolicies(
  input: CacheReferencedPrincipalPoliciesOptions,
): Promise<void> {
  await loadReferencedPrincipalPolicies(input);
}

export async function cachePrincipalPolicyBundles({
  bundles,
  currentPolicyReader,
  execSql,
  log,
  organizationId,
  reportSecurityIncident,
  resolveTrustedUserIdentity,
  stillCurrent,
}: CachePrincipalPolicyBundlesOptions): Promise<void> {
  await runPrincipalPolicyCache({
    cacheItem: (bundle, loadExternalAdminPolicy, loadDirectory) =>
      cachePrincipalPolicyBundle({
        bundle,
        execSql,
        loadExternalAdminPolicy,
        loadDirectory,
        log,
        organizationId,
        resolveTrustedUserIdentity,
        stillCurrent,
      }),
    currentPolicyReader,
    dedupe: dedupePrincipalPolicyBundles,
    execSql,
    itemKey: getBundlePrincipalKey,
    items: bundles,
    log,
    organizationId,

    reportSecurityIncident,
    resolveTrustedUserIdentity,
    stillCurrent,
  });
}

import type {
  PrincipalPolicyCheckpoint,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
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
import {
  principalPolicyReferenceFromBundle,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../../data/principals/principalPolicyAdminSigners";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  externalAdminPolicyPersistenceEntries,
  loadOrganizationExternalAdminPolicy,
  type VerifiedExternalAdminPolicy,
} from "./externalAdminPolicy";
import {
  collectPrincipalPolicySignerPublicKeys,
  type PrincipalPolicySignerPublicKeyLoadErrorCode,
  principalPolicyStates,
} from "./policyVerification";

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

function getCheckpointMismatchReason(
  checkpoint: PrincipalPolicyCheckpoint | null,
  bundle: PrincipalPolicyBundleResponse,
): string | null {
  if (!checkpoint) {
    return null;
  }
  const current = bundle.currentState;
  if (current.version < checkpoint.version) {
    return "principal policy state is older than the local checkpoint";
  }
  if (
    current.version === checkpoint.version &&
    current.stateHash !== checkpoint.stateHash
  ) {
    return "principal policy state conflicts with the local checkpoint";
  }
  if (current.version === checkpoint.version) {
    return null;
  }

  const checkpointState = principalPolicyStates(bundle).find(
    (state) => state.version === checkpoint.version,
  );
  return checkpointState?.stateHash === checkpoint.stateHash
    ? null
    : "principal policy chain does not extend the local checkpoint";
}

function signerPublicKeyLoadErrorMessage(
  code: PrincipalPolicySignerPublicKeyLoadErrorCode,
): string {
  switch (code) {
    case "fingerprint-mismatch":
      return "signer key fingerprint does not match state signer";
    case "not-found":
      return "failed to fetch signer key";
  }
}

async function validatePrincipalPolicyBundle(
  reference: ReferencedPrincipalStateResponse,
  bundle: PrincipalPolicyBundleResponse,
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
  localCheckpoint: PrincipalPolicyCheckpoint | null,
  loadExternalAdminPolicy: () => Promise<VerifiedExternalAdminPolicy | null>,
): Promise<
  | {
      readonly externalAdminPolicy: VerifiedExternalAdminPolicy | null;
      readonly ok: true;
      readonly policy: VerifiedPrincipalPolicy;
    }
  | { readonly message: string; readonly ok: false }
> {
  const referenceMismatch = getBundleReferenceMismatchReason(reference, bundle);
  if (referenceMismatch) {
    return { message: referenceMismatch, ok: false };
  }
  const checkpointMismatch = getCheckpointMismatchReason(
    localCheckpoint,
    bundle,
  );
  if (checkpointMismatch) {
    return { message: checkpointMismatch, ok: false };
  }

  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    resolveTrustedUserIdentity,
  });
  if ("error" in signerPublicKeys) {
    return {
      message: signerPublicKeyLoadErrorMessage(signerPublicKeys.error),
      ok: false,
    };
  }

  let usedExternalAdminPolicy = false;
  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference: reference,
      loadExternalAuthority: async () => {
        usedExternalAdminPolicy = true;
        return (await loadExternalAdminPolicy())?.externalAuthority ?? null;
      },
      localCheckpoint,
      signerPublicKeys: signerPublicKeys.signerPublicKeys,
    });

  return verified.ok
    ? {
        externalAdminPolicy: usedExternalAdminPolicy
          ? await loadExternalAdminPolicy()
          : null,
        ok: true,
        policy: verified.value,
      }
    : { message: verified.error.message, ok: false };
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

  const validation = await validatePrincipalPolicyBundle(
    reference,
    bundle,
    resolveTrustedUserIdentity,
    localCheckpoint,
    loadExternalAdminPolicy,
  );
  if (!validation.ok) {
    log?.(
      `Principal policy cache: skipped ${getReferencedPrincipalKey(reference)}: ${validation.message}`,
    );
    return;
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
  const validation = await validatePrincipalPolicyBundle(
    reference,
    input.bundle,
    input.resolveTrustedUserIdentity,
    localCheckpoint,
    input.loadExternalAdminPolicy,
  );
  if (!validation.ok) {
    input.log?.(
      `Principal policy cache: skipped ${getReferencedPrincipalKey(reference)}: ${validation.message}`,
    );
    return;
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

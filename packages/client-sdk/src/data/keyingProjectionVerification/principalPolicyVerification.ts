import {
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  toFingerprint,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  loadPrincipalPolicyCheckpoint,
  savePrincipalPolicyCheckpoint,
} from "../persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../persistence/principalPolicyPersistence";
import {
  verifyOrganizationAdminSignerUserIds,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../principalPolicyAdminSigners";
import type { ExecSql } from "../sqlite/sqlSchema";
import {
  filterUncachedPrincipalPolicyReferences,
  principalPolicyBundleStates,
  referencedPrincipalPolicyKey,
} from "./principalPolicyCache";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

function principalPolicyReferenceLabel(
  reference: ReferencedPrincipalHead,
): string {
  return `${reference.principalType}:${reference.principalId}@${reference.version}`;
}

async function collectPrincipalPolicySignerPublicKeys(input: {
  bundle: PrincipalPolicyBundleResponse;
  label: string;
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<PrincipalPolicySignerPublicKey[]> {
  const signerPublicKeysByKey = new Map<
    string,
    PrincipalPolicySignerPublicKey
  >();

  for (const state of principalPolicyBundleStates(input.bundle)) {
    const cacheKey = `${state.signerUserId}:${state.signerUserKeyFingerprint}`;
    if (signerPublicKeysByKey.has(cacheKey)) {
      continue;
    }

    const signerKey = await input.resolveUserKey(state.signerUserId);
    if (!signerKey) {
      throw new Error(
        `${input.label} signer key could not be resolved for ${state.signerUserId}`,
      );
    }

    const signingKeyFingerprint = await toFingerprint(
      signerKey.signingPublicKey,
    );
    if (signingKeyFingerprint !== state.signerUserKeyFingerprint) {
      throw new Error(`${input.label} signer key fingerprint mismatch`);
    }

    signerPublicKeysByKey.set(cacheKey, {
      userId: state.signerUserId,
      signingKeyFingerprint,
      signingPublicKey: signerKey.signingPublicKey,
    });
  }

  return [...signerPublicKeysByKey.values()];
}

async function loadOrganizationExternalAdminSignerUserIds(input: {
  execSql?: ExecSql | undefined;
  organizationId: string;
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<string[]> {
  if (!input.execSql) {
    return [];
  }

  const bundle = await loadPrincipalPolicyBundle(
    input.execSql,
    "organization",
    input.organizationId,
  );
  if (!bundle) {
    return [];
  }

  try {
    const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
      bundle,
      label: `Organization policy ${input.organizationId}`,
      resolveUserKey: input.resolveUserKey,
    });

    return verifyOrganizationAdminSignerUserIds({
      bundle,
      organizationId: input.organizationId,
      signerPublicKeys,
    });
  } catch {
    return [];
  }
}

async function verifyReferencedPrincipalPolicy(input: {
  execSql?: ExecSql | undefined;
  organizationId: string;
  principalPolicyCache: PrincipalPolicyCache;
  reference: ReferencedPrincipalHead;
  resolveUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy> {
  const cacheKey = referencedPrincipalPolicyKey(input.reference);
  const cachedPolicy = input.principalPolicyCache.get(cacheKey);
  if (cachedPolicy) {
    return cachedPolicy;
  }

  const referenceLabel = principalPolicyReferenceLabel(input.reference);
  if (!input.execSql) {
    throw new Error(
      `Principal policy ${referenceLabel} requires a verified local cache`,
    );
  }

  let bundle = await loadPrincipalPolicyBundle(
    input.execSql,
    input.reference.principalType,
    input.reference.principalId,
  );
  if (!bundle && input.warmReferencedPrincipalPolicies) {
    // The reference is not cached locally — the common case for a member who
    // gained access via another org's group grant and never hydrated that
    // group's policy. Fetch+verify+persist it, then re-read from the cache.
    await input.warmReferencedPrincipalPolicies({
      organizationId: input.organizationId,
      references: [input.reference],
    });
    bundle = await loadPrincipalPolicyBundle(
      input.execSql,
      input.reference.principalType,
      input.reference.principalId,
    );
  }
  if (!bundle) {
    throw new Error(`Principal policy ${referenceLabel} is not cached`);
  }

  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    label: `Principal policy ${referenceLabel}`,
    resolveUserKey: input.resolveUserKey,
  });
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    input.reference.principalType,
    input.reference.principalId,
  );
  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference: input.reference,
      loadExternalAdminSignerUserIds: () =>
        loadOrganizationExternalAdminSignerUserIds({
          execSql: input.execSql,
          organizationId: input.organizationId,
          resolveUserKey: input.resolveUserKey,
        }),
      localCheckpoint,
      signerPublicKeys,
    });
  if (!verified.ok) {
    throw new Error(
      `Principal policy ${referenceLabel} verification failed: ${verified.error.message}`,
    );
  }

  // Advance the anti-rollback pin only after the bundle verifies cleanly. The
  // bundle carries its own state chain, so the crypto layer has already
  // confirmed it extends `localCheckpoint` (or hard-failed on rollback /
  // equivocation / stale predecessor).
  await savePrincipalPolicyCheckpoint(
    input.execSql,
    verified.value.checkpoint,
    new Date().toISOString(),
  );
  input.principalPolicyCache.set(cacheKey, verified.value);
  return verified.value;
}

export async function collectReferencedPrincipalPolicies(input: {
  execSql?: ExecSql | undefined;
  organizationId: string;
  principalPolicyCache: PrincipalPolicyCache;
  references: readonly ReferencedPrincipalHead[];
  resolveUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  const uniqueReferences = new Map<string, ReferencedPrincipalHead>();
  for (const reference of input.references) {
    uniqueReferences.set(referencedPrincipalPolicyKey(reference), reference);
  }

  const references = [...uniqueReferences.values()];
  // Warm every missing reference in one batched fetch before verifying, so a
  // path that references several uncached policies makes a single round of
  // requests rather than one per reference.
  if (input.warmReferencedPrincipalPolicies && input.execSql) {
    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql: input.execSql,
      principalPolicyCache: input.principalPolicyCache,
      references,
    });
    if (uncached.length > 0) {
      await input.warmReferencedPrincipalPolicies({
        organizationId: input.organizationId,
        references: uncached,
      });
    }
  }

  return Promise.all(
    references.map((reference) =>
      verifyReferencedPrincipalPolicy({
        execSql: input.execSql,
        organizationId: input.organizationId,
        principalPolicyCache: input.principalPolicyCache,
        reference,
        resolveUserKey: input.resolveUserKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      }),
    ),
  );
}

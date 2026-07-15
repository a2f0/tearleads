import {
  KeyingVerificationError,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  toFingerprint,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { principalPolicyHeadMeetsCheckpoint } from "../persistence/principalPolicyCheckpointSelection";
import { loadPrincipalPolicyBundle } from "../persistence/principalPolicyPersistence";
import {
  organizationAdminSignerUserIds,
  principalPolicyReferenceFromBundle,
  verifyOrganizationAdminPolicy,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../principalPolicyAdminSigners";
import {
  observePrincipalPolicy,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
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
  checkpointContext: ProjectionCheckpointContext;
  organizationId: string;
  resolveUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<string[]> {
  const execSql = input.checkpointContext.execSql;
  let bundle = await loadPrincipalPolicyBundle(
    execSql,
    "organization",
    input.organizationId,
  );
  if (!bundle) {
    return [];
  }
  let localCheckpoint = await loadPrincipalPolicyCheckpoint(
    execSql,
    "organization",
    input.organizationId,
  );
  if (
    !principalPolicyHeadMeetsCheckpoint(bundle.currentState, localCheckpoint) &&
    input.warmReferencedPrincipalPolicies
  ) {
    await input.warmReferencedPrincipalPolicies({
      organizationId: input.organizationId,
      references: [principalPolicyReferenceFromBundle(bundle)],
    });
    bundle = await loadPrincipalPolicyBundle(
      execSql,
      "organization",
      input.organizationId,
    );
    localCheckpoint = await loadPrincipalPolicyCheckpoint(
      execSql,
      "organization",
      input.organizationId,
    );
    if (!bundle) {
      return [];
    }
  }

  try {
    const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
      bundle,
      label: `Organization policy ${input.organizationId}`,
      resolveUserKey: input.resolveUserKey,
    });
    const verified = await verifyOrganizationAdminPolicy({
      bundle,
      localCheckpoint,
      organizationId: input.organizationId,
      signerPublicKeys,
    });
    if (!verified.ok) {
      throw verified.error;
    }
    observePrincipalPolicy(input.checkpointContext, verified.value);
    return organizationAdminSignerUserIds(verified.value);
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    return [];
  }
}

async function verifyReferencedPrincipalPolicy(input: {
  checkpointContext: ProjectionCheckpointContext;
  organizationId: string;
  principalPolicyCache: PrincipalPolicyCache;
  reference: ReferencedPrincipalHead;
  resolveUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy> {
  const cacheKey = referencedPrincipalPolicyKey(input.reference);
  const cachedPolicy = input.principalPolicyCache.get(cacheKey);
  const execSql = input.checkpointContext.execSql;
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    execSql,
    input.reference.principalType,
    input.reference.principalId,
  );
  if (
    cachedPolicy &&
    principalPolicyHeadMeetsCheckpoint(cachedPolicy, localCheckpoint)
  ) {
    observePrincipalPolicy(input.checkpointContext, cachedPolicy);
    return cachedPolicy;
  }

  const referenceLabel = principalPolicyReferenceLabel(input.reference);
  let bundle = await loadPrincipalPolicyBundle(
    execSql,
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
      execSql,
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
  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference: input.reference,
      loadExternalAdminSignerUserIds: () =>
        loadOrganizationExternalAdminSignerUserIds({
          checkpointContext: input.checkpointContext,
          organizationId: input.organizationId,
          resolveUserKey: input.resolveUserKey,
          warmReferencedPrincipalPolicies:
            input.warmReferencedPrincipalPolicies,
        }),
      localCheckpoint,
      signerPublicKeys,
    });
  if (!verified.ok) {
    throw verified.error;
  }

  observePrincipalPolicy(input.checkpointContext, verified.value);
  input.principalPolicyCache.set(cacheKey, verified.value);
  return verified.value;
}

export async function collectReferencedPrincipalPolicies(input: {
  checkpointContext: ProjectionCheckpointContext;
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
  if (input.warmReferencedPrincipalPolicies) {
    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql: input.checkpointContext.execSql,
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
        checkpointContext: input.checkpointContext,
        organizationId: input.organizationId,
        principalPolicyCache: input.principalPolicyCache,
        reference,
        resolveUserKey: input.resolveUserKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      }),
    ),
  );
}

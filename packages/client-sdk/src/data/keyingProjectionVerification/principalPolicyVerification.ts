import {
  KeyingVerificationError,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  toFingerprint,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@symcrypt/crypto";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import {
  principalPolicyHeadMeetsCheckpoint,
  verifiedPrincipalPolicyMeetsCheckpoint,
} from "../persistence/principalPolicyCheckpointSelection";
import { loadPrincipalPolicyBundle } from "../persistence/principalPolicyPersistence";
import { loadPrincipalPolicyBundleForReference } from "../persistence/principalPolicyReferencePersistence";
import { principalPolicyBundleStates } from "../principalPolicyStates";
import {
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
  requireOrganizationGroupHead,
} from "../principals/organizationAuthorityDescriptor";
import {
  organizationAdminExternalAuthority,
  principalPolicyReferenceFromBundle,
  verifyOrganizationAdminPolicy,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../principals/principalPolicyAdminSigners";
import {
  observePrincipalPolicy,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import {
  filterUncachedPrincipalPolicyReferences,
  referencedPrincipalPolicyKey,
  verifiedPrincipalPolicyContainsReference,
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

/**
 * A referenced principal policy is not in the local store and warming could
 * not fetch it this pass — a transient cold-cache condition, typical for a
 * member whose access arrives via a group policy the device has not hydrated
 * yet. Sync passes discriminate on this type to defer the affected container
 * and retry on a later trigger, rather than failing the whole pass.
 */
export class PrincipalPolicyNotCachedError extends Error {
  constructor(referenceLabel: string) {
    super(`Principal policy ${referenceLabel} is not cached`);
    this.name = "PrincipalPolicyNotCachedError";
  }
}

export function isPrincipalPolicyNotCachedError(error: unknown): boolean {
  return (
    error instanceof PrincipalPolicyNotCachedError ||
    (error instanceof Error && error.name === "PrincipalPolicyNotCachedError")
  );
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

type OrganizationAdminPolicyInput = {
  checkpointContext: ProjectionCheckpointContext;
  organizationId: string;
  resolveUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
};

async function loadOrganizationPolicyForVerification(
  input: OrganizationAdminPolicyInput,
): Promise<
  | {
      bundle: PrincipalPolicyBundleResponse;
      localCheckpoint: Awaited<
        ReturnType<typeof loadPrincipalPolicyCheckpoint>
      >;
    }
  | undefined
> {
  const execSql = input.checkpointContext.execSql;
  let bundle = await loadPrincipalPolicyBundle(
    execSql,
    "organization",
    input.organizationId,
  );
  if (!bundle) {
    return undefined;
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
      return undefined;
    }
  }

  return { bundle, localCheckpoint };
}

function assertReservedAdminsPolicyShape(
  policy: VerifiedPrincipalPolicy,
): void {
  const history = policy.history ?? [{ projection: policy.projection }];
  if (
    history.some(
      (entry) =>
        entry.projection.length === 0 ||
        entry.projection.some((member) => member.role !== "admin"),
    )
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "reserved Admins policy must contain only direct admin users",
    );
  }
}

async function verifyOrganizationAdminsPolicy(input: {
  adminGroupId: string;
  execSql: ProjectionCheckpointContext["execSql"];
  expectedHead: ReferencedPrincipalHead;
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedPrincipalPolicy | undefined> {
  const adminBundle = await loadPrincipalPolicyBundle(
    input.execSql,
    "group",
    input.adminGroupId,
  );
  if (!adminBundle) {
    return undefined;
  }
  if (
    !principalHeadMatchesReference(
      principalPolicyReferenceFromBundle(adminBundle),
      input.expectedHead,
    )
  ) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Admins policy does not match the signed organization directory",
    );
  }
  const adminCheckpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    "group",
    input.adminGroupId,
  );
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle: adminBundle,
    label: `Admins policy ${input.adminGroupId}`,
    resolveUserKey: input.resolveUserKey,
  });
  const verified = await verifyPrincipalPolicyBundle({
    bundle: adminBundle,
    expectedReference: input.expectedHead,
    localCheckpoint: adminCheckpoint,
    signerPublicKeys,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  assertReservedAdminsPolicyShape(verified.value);
  return verified.value;
}

async function loadOrganizationExternalAuthority(
  input: OrganizationAdminPolicyInput,
): Promise<ReturnType<typeof organizationAdminExternalAuthority> | null> {
  const organizationPolicy = await loadOrganizationPolicyForVerification(input);
  if (!organizationPolicy) {
    return null;
  }

  try {
    const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
      bundle: organizationPolicy.bundle,
      label: `Organization policy ${input.organizationId}`,
      resolveUserKey: input.resolveUserKey,
    });
    const verified = await verifyOrganizationAdminPolicy({
      bundle: organizationPolicy.bundle,
      localCheckpoint: organizationPolicy.localCheckpoint,
      organizationId: input.organizationId,
      signerPublicKeys,
    });
    if (!verified.ok) {
      throw verified.error;
    }
    const descriptor = parseOrganizationAuthorityDescriptor(
      organizationPolicy.bundle.currentPayload.ciphertext,
    );
    if (descriptor.organizationId !== input.organizationId) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "organization authority descriptor scope does not match",
      );
    }
    const verifiedAdmins = await verifyOrganizationAdminsPolicy({
      adminGroupId: descriptor.adminGroupId,
      execSql: input.checkpointContext.execSql,
      expectedHead: requireOrganizationGroupHead(
        descriptor,
        descriptor.adminGroupId,
      ),
      resolveUserKey: input.resolveUserKey,
    });
    if (!verifiedAdmins) {
      return null;
    }
    observePrincipalPolicy(
      input.checkpointContext,
      verified.value,
      input.organizationId,
    );
    observePrincipalPolicy(
      input.checkpointContext,
      verifiedAdmins,
      input.organizationId,
    );
    return organizationAdminExternalAuthority(verifiedAdmins);
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    return null;
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
  if (cachedPolicy) {
    if (
      !verifiedPrincipalPolicyContainsReference(cachedPolicy, input.reference)
    ) {
      throw new KeyingVerificationError(
        "hash_mismatch",
        "in-memory principal policy cache does not match its exact reference",
      );
    }
    if (verifiedPrincipalPolicyMeetsCheckpoint(cachedPolicy, localCheckpoint)) {
      observePrincipalPolicy(
        input.checkpointContext,
        cachedPolicy,
        input.organizationId,
      );
      return cachedPolicy;
    }
  }

  const referenceLabel = principalPolicyReferenceLabel(input.reference);
  let bundle = await loadPrincipalPolicyBundleForReference(
    execSql,
    input.reference,
    localCheckpoint,
  );
  if (!bundle && input.warmReferencedPrincipalPolicies) {
    // The reference is not cached locally — the common case for a member who
    // gained access via another org's group grant and never hydrated that
    // group's policy. Fetch+verify+persist it, then re-read from the cache.
    await input.warmReferencedPrincipalPolicies({
      organizationId: input.organizationId,
      references: [input.reference],
    });
    bundle = await loadPrincipalPolicyBundleForReference(
      execSql,
      input.reference,
      localCheckpoint,
    );
  }
  if (!bundle) {
    throw new PrincipalPolicyNotCachedError(referenceLabel);
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
      loadExternalAuthority: () =>
        loadOrganizationExternalAuthority({
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

  observePrincipalPolicy(
    input.checkpointContext,
    verified.value,
    input.organizationId,
  );
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

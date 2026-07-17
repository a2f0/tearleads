import {
  KeyingVerificationError,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  toFingerprint,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { parseOrganizationAuthorityDescriptor } from "../organizationAuthorityDescriptor";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { principalPolicyHeadMeetsCheckpoint } from "../persistence/principalPolicyCheckpointSelection";
import { loadPrincipalPolicyBundle } from "../persistence/principalPolicyPersistence";
import {
  organizationAdminExternalAuthority,
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
        entry.projection.some(
          (member) =>
            member.memberPrincipalType !== "user" || member.role !== "admin",
        ),
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
    expectedReference: principalPolicyReferenceFromBundle(adminBundle),
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
      resolveUserKey: input.resolveUserKey,
    });
    if (!verifiedAdmins) {
      return null;
    }
    observePrincipalPolicy(input.checkpointContext, verified.value);
    observePrincipalPolicy(input.checkpointContext, verifiedAdmins);
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

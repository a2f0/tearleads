import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { loadPrincipalPolicyCheckpoint } from "../../persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../persistence/principalPolicy/principalPolicyPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../persistence/principalPolicy/principalPolicyReferencePersistence";
import {
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
  requireOrganizationGroupHead,
} from "../../principals/organizationAuthorityDescriptor";
import {
  assertPrincipalIdentityCommitments,
  publishVerifiedPolicyBundle,
} from "../../principals/principalIdentityCommitments";
import {
  organizationAdminExternalAuthority,
  principalPolicyReferenceFromBundle,
  verifyOrganizationAdminPolicy,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../../principals/principalPolicyAdminSigners";
import {
  type PrincipalPolicyCurrentEvidence,
  principalPolicyEvidenceEntries,
} from "../../principals/principalPolicyEvidence";
import {
  observePrincipalPolicy,
  type ProjectionCheckpointContext,
} from "../checkpoints/checkpointContext";
import { rethrowProjectionVerificationBoundaryError } from "../error";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../types";
import {
  assertProjectionVerificationCurrent,
  generationGuardedPrincipalPolicyWarmer,
} from "../types";
import {
  filterUncachedPrincipalPolicyReferences,
  referencedPrincipalPolicyKey,
  verifiedPrincipalPolicyContainsReference,
} from "./principalPolicyCache";
import {
  principalPolicyHeadMeetsCheckpoint,
  verifiedPrincipalPolicyMeetsCheckpoint,
} from "./principalPolicyCheckpointSelection";
import { collectPrincipalPolicySignerPublicKeys } from "./principalPolicySigners";
import { resolveReferencedPrincipalPolicy } from "./resolvedPrincipalPolicy";

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

type OrganizationAdminPolicyInput = {
  checkpointContext: ProjectionCheckpointContext;
  organizationId: string;
  resolveUserKey: ProjectionUserKeyResolver;
  /** The verification's lifetime, checked inside every pin write. */
  stillCurrent?: (() => boolean) | undefined;
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
  stillCurrent: (() => boolean) | undefined;
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
  await publishVerifiedPolicyBundle(adminBundle, input.resolveUserKey, () =>
    assertProjectionVerificationCurrent(input.stillCurrent),
  );
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
    await publishVerifiedPolicyBundle(
      organizationPolicy.bundle,
      input.resolveUserKey,
      () => assertProjectionVerificationCurrent(input.stillCurrent),
    );
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
      stillCurrent: input.stillCurrent,
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
    rethrowProjectionVerificationBoundaryError(error);
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    return null;
  }
}

/**
 * Fresh or reused: check every projection, history included; pin first
 * sights within the verification's lifetime. A freshly verified `bundle` also
 * pins its signers.
 */
async function assertVerifiedPolicyCommitments(
  policy: PrincipalPolicyCurrentEvidence,
  scope: {
    readonly resolveUserKey: ProjectionUserKeyResolver;
    readonly stillCurrent?: (() => boolean) | undefined;
  },
  bundle?: PrincipalPolicyBundleResponse,
): Promise<void> {
  const assertCurrent = () =>
    assertProjectionVerificationCurrent(scope.stillCurrent);
  await assertPrincipalIdentityCommitments({
    assertCurrent,
    authenticated: true,
    projections: [
      policy.projection,
      ...principalPolicyEvidenceEntries(policy).map(
        (entry) => entry.projection,
      ),
    ],
    resolveTrustedUserIdentity: scope.resolveUserKey,
  });
  if (bundle)
    await publishVerifiedPolicyBundle(
      bundle,
      scope.resolveUserKey,
      assertCurrent,
    );
}

async function verifyReferencedPrincipalPolicy(input: {
  checkpointContext: ProjectionCheckpointContext;
  organizationId: string;
  principalPolicyCache: PrincipalPolicyCache;
  reference: ReferencedPrincipalHead;
  stillCurrent?: (() => boolean) | undefined;
  resolveUserKey: ProjectionUserKeyResolver;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<PrincipalPolicyCurrentEvidence> {
  // Scoped recovery carries organization, dependency and lifetime bindings.
  // A bare policy cache entry cannot replace those bindings.
  const recovered = await resolveReferencedPrincipalPolicy(input);
  if (recovered) {
    await assertVerifiedPolicyCommitments(recovered, input);
    return recovered;
  }
  const cacheKey = referencedPrincipalPolicyKey(input.reference);
  const cachedPolicy = input.principalPolicyCache.get(cacheKey);
  const execSql = input.checkpointContext.execSql;
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    execSql,
    input.reference.principalType,
    input.reference.principalId,
  );
  if (cachedPolicy && !("retainedHistory" in cachedPolicy)) {
    if (
      !verifiedPrincipalPolicyContainsReference(cachedPolicy, input.reference)
    ) {
      throw new KeyingVerificationError(
        "hash_mismatch",
        "in-memory principal policy cache does not match its exact reference",
      );
    }
    if (verifiedPrincipalPolicyMeetsCheckpoint(cachedPolicy, localCheckpoint)) {
      await assertVerifiedPolicyCommitments(cachedPolicy, input);
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
          stillCurrent: input.stillCurrent,
          warmReferencedPrincipalPolicies:
            input.warmReferencedPrincipalPolicies,
        }),
      localCheckpoint,
      signerPublicKeys,
    });
  if (!verified.ok) {
    throw verified.error;
  }
  await assertVerifiedPolicyCommitments(verified.value, input, bundle);

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
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<PrincipalPolicyCurrentEvidence[]> {
  const warmReferencedPrincipalPolicies =
    generationGuardedPrincipalPolicyWarmer(
      input.warmReferencedPrincipalPolicies,
      input.stillCurrent,
    );
  const uniqueReferences = new Map<string, ReferencedPrincipalHead>();
  for (const reference of input.references) {
    uniqueReferences.set(referencedPrincipalPolicyKey(reference), reference);
  }

  const references = [...uniqueReferences.values()];
  // Warm every missing reference in one batched fetch before verifying, so a
  // path that references several uncached policies makes a single round of
  // requests rather than one per reference.
  if (
    warmReferencedPrincipalPolicies &&
    !warmReferencedPrincipalPolicies.resolveReference
  ) {
    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql: input.checkpointContext.execSql,
      principalPolicyCache: input.principalPolicyCache,
      references,
    });
    if (uncached.length > 0) {
      assertProjectionVerificationCurrent(input.stillCurrent);
      await warmReferencedPrincipalPolicies({
        organizationId: input.organizationId,
        references: uncached,
      });
      assertProjectionVerificationCurrent(input.stillCurrent);
    }
  }

  // The warmer's operation shares one recovery view across its collections.
  return Promise.all(
    references.map((reference) =>
      verifyReferencedPrincipalPolicy({
        checkpointContext: input.checkpointContext,
        organizationId: input.organizationId,
        principalPolicyCache: input.principalPolicyCache,
        reference,
        stillCurrent: input.stillCurrent,
        resolveUserKey: input.resolveUserKey,
        warmReferencedPrincipalPolicies,
      }),
    ),
  );
}

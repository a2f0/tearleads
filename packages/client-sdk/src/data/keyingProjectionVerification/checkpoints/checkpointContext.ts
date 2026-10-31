import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
  type VerifiedContainerAccessManifest,
  type VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import {
  type AccessManifestBundleWireResponse,
  type ContainerKeyingPathResponse,
  containerKekWireLevel,
} from "@tearleads/validators/response";
import { rememberVerifiedContainerHeads } from "../../containers/shared/heldContainerHeads";
import type { DocumentPurgeCheckpoint } from "../../persistence/keyingCheckpoints/documentPurgeCheckpointPersistence";
import { PrincipalAuthorizationCheckpointUnavailableError } from "../../persistence/keyingCheckpoints/principalAuthorizationCheckpoints";
import type { VerifiedManifestBundle } from "../../persistence/verifiedManifestBundlePersistence";
import type { PrincipalPolicyCheckpointEvidence } from "../../principals/principalPolicyEvidence";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ProjectionDependencyUnavailableError } from "../dependencyUnavailable";
import { projectionLifetimeGuard } from "../projectionLifetimes";
import { assertProjectionVerificationCurrent } from "../types";
import {
  enforceAccessManifestCheckpoints,
  validateAccessManifestCheckpoints,
} from "./accessManifestCheckpointEnforcement";
import { matchesVerifiedBundleBytes } from "./verifiedBundleBytes";

export interface ProjectionCheckpointContext {
  readonly heldContainerHeads: VerifiedContainerAccessManifest[];
  readonly execSql: ExecSql;
  // Local checkpoints read during this verification, one read per object.
  readonly localCheckpoints: Map<string, AccessManifestCheckpoint | null>;
  organizationId?: string | undefined;
  readonly policies: PrincipalPolicyCheckpointEvidence[];
  readonly authorizationPolicies: VerifiedPrincipalPolicySelection[];
  // Served bundles whose manifests verified, and KEK levels of verified
  // paths, stored at finalization.
  readonly verifiedBundles: VerifiedManifestBundle[];
  readonly verifiedHeads: VerifiedAccessManifestCheckpointEvidence[];
  readonly verifiedManifests: VerifiedAccessManifestCheckpointEvidence[];
}

export function createProjectionCheckpointContext(input: {
  readonly execSql: ExecSql;
  readonly organizationId?: string | undefined;
}): ProjectionCheckpointContext {
  if (typeof input.execSql !== "function") {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Projection verification requires durable keying checkpoint storage",
    );
  }

  return {
    heldContainerHeads: [],
    execSql: input.execSql,
    localCheckpoints: new Map(),
    organizationId: input.organizationId,
    policies: [],
    authorizationPolicies: [],
    verifiedBundles: [],
    verifiedHeads: [],
    verifiedManifests: [],
  };
}

export function observeAccessManifestCheckpoints(
  context: ProjectionCheckpointContext,
  input: {
    readonly verifiedHeads: readonly VerifiedAccessManifestCheckpointEvidence[];
    readonly verifiedManifests: readonly VerifiedAccessManifestCheckpointEvidence[];
  },
): void {
  context.verifiedHeads.push(...input.verifiedHeads);
  context.verifiedManifests.push(...input.verifiedManifests);
}

/**
 * Records each served bundle whose manifest this verification produced, so
 * the transaction finalizing the checkpoints also stores it for later
 * citation. A bundle the projection carried but verification never reached
 * is skipped.
 */
export function observeVerifiedProjectionBundles(
  context: ProjectionCheckpointContext,
  bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>,
  verifiedByHash: ReadonlyMap<
    string,
    { readonly checkpoint: AccessManifestCheckpoint }
  >,
): void {
  for (const [manifestHash, bundle] of bundlesByHash) {
    const verified = verifiedByHash.get(manifestHash);
    // A cache hit verifies the hash, not these bytes: store only bytes that
    // a fresh verification accepted, so a citation never replays others.
    if (verified && matchesVerifiedBundleBytes(verified, bundle))
      context.verifiedBundles.push({ bundle, checkpoint: verified.checkpoint });
  }
}

/**
 * Records every KEK level of paths this verification accepted in full, so
 * the finalizing transaction stores them for later citation by digest. A
 * cited level is refilled from these bytes only when the API's current
 * level has the same digest, and is verified again like a served one.
 */
export function observeVerifiedKekLevels(
  context: ProjectionCheckpointContext,
  paths: readonly ContainerKeyingPathResponse[],
): void {
  for (const path of paths)
    for (const kek of path.containerKeks)
      context.verifiedBundles.push({
        kekLevel: containerKekWireLevel(kek),
        organizationId: path.organizationId,
      });
}

export function observePrincipalPolicy(
  context: ProjectionCheckpointContext,
  policy: PrincipalPolicyCheckpointEvidence,
  organizationId?: string | undefined,
): void {
  if (
    organizationId !== undefined &&
    context.organizationId !== undefined &&
    context.organizationId !== organizationId
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "projection checkpoint batch crosses organization ownership",
    );
  }
  context.organizationId ??= organizationId;
  context.policies.push(policy);
}

export async function commitProjectionCheckpoints(
  context: ProjectionCheckpointContext,
  input?: {
    readonly documentPurgeCheckpoint?: DocumentPurgeCheckpoint | undefined;
    readonly execSql?: ExecSql | undefined;
    readonly stillCurrent?: (() => boolean) | undefined;
  },
): Promise<void> {
  input = {
    ...input,
    stillCurrent: projectionLifetimeGuard(context, input?.stillCurrent),
  };
  assertProjectionVerificationCurrent(input?.stillCurrent);
  await enforceAccessManifestCheckpoints({
    documentPurgeCheckpoint: input?.documentPurgeCheckpoint,
    execSql: input?.execSql ?? context.execSql,
    organizationId: context.organizationId,
    policies: context.policies,
    authorizationPolicies: context.authorizationPolicies,
    stillCurrent: input?.stillCurrent,
    verifiedBundles: context.verifiedBundles,
    verifiedHeads: context.verifiedHeads,
    verifiedManifests: context.verifiedManifests,
  }).catch((error: unknown) => {
    if (error instanceof PrincipalAuthorizationCheckpointUnavailableError)
      throw new ProjectionDependencyUnavailableError(error.message);
    throw error;
  });
  assertProjectionVerificationCurrent(input?.stillCurrent);
}

/** Validates against the latest durable pins without persisting new heads. */
async function validateProjectionCheckpoints(
  context: ProjectionCheckpointContext,
  input?: {
    readonly execSql?: ExecSql | undefined;
    readonly stillCurrent?: (() => boolean) | undefined;
  },
): Promise<void> {
  input = {
    ...input,
    stillCurrent: projectionLifetimeGuard(context, input?.stillCurrent),
  };
  assertProjectionVerificationCurrent(input?.stillCurrent);
  await validateAccessManifestCheckpoints({
    execSql: input?.execSql ?? context.execSql,
    policies: context.policies,
    authorizationPolicies: context.authorizationPolicies,
    stillCurrent: input?.stillCurrent,
    verifiedBundles: context.verifiedBundles,
    verifiedHeads: context.verifiedHeads,
    verifiedManifests: context.verifiedManifests,
  }).catch((error: unknown) => {
    if (error instanceof PrincipalAuthorizationCheckpointUnavailableError)
      throw new ProjectionDependencyUnavailableError(error.message);
    throw error;
  });
  assertProjectionVerificationCurrent(input?.stillCurrent);
}

export async function finalizeProjectionCheckpoints(
  context: ProjectionCheckpointContext,
  input: {
    readonly execSql?: ExecSql | undefined;
    readonly persistVerificationCheckpoints?: boolean | undefined;
    readonly stillCurrent?: (() => boolean) | undefined;
  },
): Promise<void> {
  if (input.persistVerificationCheckpoints === false) {
    await validateProjectionCheckpoints(context, input);
    return;
  }
  await commitProjectionCheckpoints(context, input);
  if (input.stillCurrent?.() === false) return;
  const organizationId =
    context.organizationId ??
    context.heldContainerHeads[0]?.state.organizationId;
  if (organizationId === undefined) return;
  try {
    rememberVerifiedContainerHeads({
      organizationId,
      execSql: input.execSql ?? context.execSql,
      heads: context.heldContainerHeads,
      policies: context.policies,
    });
  } catch {
    // Checkpoints are already committed. Optional re-citation evidence must
    // never change successful verification into a caller-visible refusal.
  }
}

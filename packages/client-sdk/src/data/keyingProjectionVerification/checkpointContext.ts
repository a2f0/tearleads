import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
  type VerifiedContainerAccessManifest,
  type VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import { rememberVerifiedContainerHeads } from "../containers/shared/heldContainerHeads";
import type { DocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import { PrincipalAuthorizationCheckpointUnavailableError } from "../persistence/principalAuthorizationCheckpoints";
import type { PrincipalPolicyCheckpointEvidence } from "../principals/principalPolicyEvidence";
import type { ExecSql } from "../sqlite/sqlSchema";
import {
  enforceAccessManifestCheckpoints,
  validateAccessManifestCheckpoints,
} from "./accessManifestCheckpointEnforcement";
import { ProjectionDependencyUnavailableError } from "./dependencyUnavailable";
import { projectionLifetimeGuard } from "./projectionLifetimes";
import { assertProjectionVerificationCurrent } from "./types";

export interface ProjectionCheckpointContext {
  readonly heldContainerHeads: VerifiedContainerAccessManifest[];
  readonly execSql: ExecSql;
  // Local checkpoints read during this verification, one read per object.
  readonly localCheckpoints: Map<string, AccessManifestCheckpoint | null>;
  organizationId?: string | undefined;
  readonly policies: PrincipalPolicyCheckpointEvidence[];
  readonly authorizationPolicies: VerifiedPrincipalPolicySelection[];
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

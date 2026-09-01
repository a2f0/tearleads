import {
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
} from "@symcrypt/crypto";
import type { DocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { enforceAccessManifestCheckpoints } from "./accessManifestCheckpointEnforcement";

export interface ProjectionCheckpointContext {
  readonly execSql: ExecSql;
  organizationId?: string | undefined;
  readonly policies: AnyVerifiedPrincipalPolicy[];
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
    execSql: input.execSql,
    organizationId: input.organizationId,
    policies: [],
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
  policy: AnyVerifiedPrincipalPolicy,
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
  await enforceAccessManifestCheckpoints({
    documentPurgeCheckpoint: input?.documentPurgeCheckpoint,
    execSql: input?.execSql ?? context.execSql,
    organizationId: context.organizationId,
    policies: context.policies,
    stillCurrent: input?.stillCurrent,
    verifiedHeads: context.verifiedHeads,
    verifiedManifests: context.verifiedManifests,
  });
}

import {
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
  type VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type { DocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { enforceAccessManifestCheckpoints } from "./accessManifestCheckpointEnforcement";

export interface ProjectionCheckpointContext {
  readonly execSql: ExecSql;
  readonly policies: VerifiedPrincipalPolicy[];
  readonly verifiedHeads: VerifiedAccessManifestCheckpointEvidence[];
  readonly verifiedManifests: VerifiedAccessManifestCheckpointEvidence[];
}

export function createProjectionCheckpointContext(input: {
  readonly execSql: ExecSql;
}): ProjectionCheckpointContext {
  if (typeof input.execSql !== "function") {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Projection verification requires durable keying checkpoint storage",
    );
  }

  return {
    execSql: input.execSql,
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
  policy: VerifiedPrincipalPolicy,
): void {
  context.policies.push(policy);
}

export async function commitProjectionCheckpoints(
  context: ProjectionCheckpointContext,
  input?: {
    readonly documentPurgeCheckpoint?: DocumentPurgeCheckpoint | undefined;
    readonly execSql?: ExecSql | undefined;
  },
): Promise<void> {
  await enforceAccessManifestCheckpoints({
    documentPurgeCheckpoint: input?.documentPurgeCheckpoint,
    execSql: input?.execSql ?? context.execSql,
    policies: context.policies,
    verifiedHeads: context.verifiedHeads,
    verifiedManifests: context.verifiedManifests,
  });
}

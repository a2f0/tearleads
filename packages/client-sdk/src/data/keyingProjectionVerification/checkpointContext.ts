import {
  type AnyVerifiedAccessManifest,
  KeyingVerificationError,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ExecSql } from "../sqlite/sqlSchema";
import { enforceAccessManifestCheckpoints } from "./accessManifestCheckpointEnforcement";

export interface ProjectionCheckpointContext {
  readonly execSql: ExecSql | null;
  readonly policies: VerifiedPrincipalPolicy[];
  readonly verifiedHeads: AnyVerifiedAccessManifest[];
  readonly verifiedManifests: AnyVerifiedAccessManifest[];
}

export function createProjectionCheckpointContext(input: {
  readonly execSql?: ExecSql | undefined;
  readonly label: string;
}): ProjectionCheckpointContext {
  if (!input.execSql) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} requires durable keying checkpoint storage`,
    );
  }

  return {
    execSql: input.execSql ?? null,
    policies: [],
    verifiedHeads: [],
    verifiedManifests: [],
  };
}

export function observeAccessManifestCheckpoints(
  context: ProjectionCheckpointContext,
  input: {
    readonly verifiedHeads: readonly AnyVerifiedAccessManifest[];
    readonly verifiedManifests: readonly AnyVerifiedAccessManifest[];
  },
): void {
  if (!context.execSql) {
    return;
  }
  context.verifiedHeads.push(...input.verifiedHeads);
  context.verifiedManifests.push(...input.verifiedManifests);
}

export function observePrincipalPolicy(
  context: ProjectionCheckpointContext,
  policy: VerifiedPrincipalPolicy,
): void {
  if (context.execSql) {
    context.policies.push(policy);
  }
}

export async function commitProjectionCheckpoints(
  context: ProjectionCheckpointContext,
): Promise<void> {
  if (!context.execSql) {
    return;
  }
  await enforceAccessManifestCheckpoints({
    execSql: context.execSql,
    policies: context.policies,
    verifiedHeads: context.verifiedHeads,
    verifiedManifests: context.verifiedManifests,
  });
}

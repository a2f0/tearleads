import {
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
  type VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import type { DocumentPurgeCheckpoint } from "../../persistence/keyingCheckpoints/documentPurgeCheckpointPersistence";
import type { AccessManifestCheckpointAdvance } from "../../persistence/keyingCheckpoints/keyingCheckpointAdvancePersistence";
import { KeyingCheckpointRepository } from "../../persistence/keyingCheckpoints/keyingCheckpointRepository";
import type { VerifiedManifestBundle } from "../../persistence/verifiedManifestBundlePersistence";
import type { PrincipalPolicyCheckpointEvidence } from "../../principalContracts/principalPolicyEvidence";
import type { ExecSql } from "../../sqlite/sqlSchema";

function objectKey(manifest: VerifiedAccessManifestCheckpointEvidence): string {
  const { objectKind, organizationId, objectId } = manifest.checkpoint;
  return JSON.stringify([objectKind, organizationId, objectId]);
}

function manifestsByObject(
  manifests: readonly VerifiedAccessManifestCheckpointEvidence[],
): Map<string, Map<string, VerifiedAccessManifestCheckpointEvidence>> {
  const byObject = new Map<
    string,
    Map<string, VerifiedAccessManifestCheckpointEvidence>
  >();
  for (const manifest of manifests) {
    const key = objectKey(manifest);
    let byHash = byObject.get(key);
    if (!byHash) {
      byHash = new Map();
      byObject.set(key, byHash);
    }
    byHash.set(manifest.manifestHash, manifest);
  }
  return byObject;
}

function accessManifestCheckpointAdvances(input: {
  readonly verifiedHeads: readonly VerifiedAccessManifestCheckpointEvidence[];
  readonly verifiedManifests: readonly VerifiedAccessManifestCheckpointEvidence[];
}): AccessManifestCheckpointAdvance[] {
  const evidenceByObject = manifestsByObject(input.verifiedManifests);
  const headsByObject = manifestsByObject(input.verifiedHeads);
  const advances: AccessManifestCheckpointAdvance[] = [];

  for (const [key, headsByHash] of headsByObject) {
    if (headsByHash.size !== 1) {
      throw new KeyingVerificationError(
        "equivocation",
        `projection declares conflicting access manifest heads for ${key}`,
      );
    }
    const head = headsByHash.values().next().value;
    if (!head) {
      continue;
    }
    const predecessors = [
      ...(evidenceByObject.get(key)?.values() ?? []),
    ].filter((manifest) => manifest.manifestHash !== head.manifestHash);
    advances.push({ head, predecessors });
  }

  return advances;
}

export async function validateAccessManifestCheckpoints(input: {
  readonly execSql: ExecSql;
  readonly policies: readonly PrincipalPolicyCheckpointEvidence[];
  readonly authorizationPolicies?:
    | readonly VerifiedPrincipalPolicySelection[]
    | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly verifiedBundles?: readonly VerifiedManifestBundle[] | undefined;
  readonly verifiedHeads: readonly VerifiedAccessManifestCheckpointEvidence[];
  readonly verifiedManifests: readonly VerifiedAccessManifestCheckpointEvidence[];
}): Promise<void> {
  await new KeyingCheckpointRepository(
    input.execSql,
  ).validateKeyingCheckpointsAtomically({
    access: accessManifestCheckpointAdvances(input),
    policies: input.policies,
    authorizationPolicies: input.authorizationPolicies,
    stillCurrent: input.stillCurrent,
    verifiedBundles: input.verifiedBundles,
  });
}

export async function enforceAccessManifestCheckpoints(input: {
  readonly execSql: ExecSql;
  readonly organizationId?: string | undefined;
  readonly documentPurgeCheckpoint?: DocumentPurgeCheckpoint | undefined;
  readonly policies: readonly PrincipalPolicyCheckpointEvidence[];
  readonly authorizationPolicies?:
    | readonly VerifiedPrincipalPolicySelection[]
    | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly verifiedBundles?: readonly VerifiedManifestBundle[] | undefined;
  readonly verifiedHeads: readonly VerifiedAccessManifestCheckpointEvidence[];
  readonly verifiedManifests: readonly VerifiedAccessManifestCheckpointEvidence[];
}): Promise<void> {
  await new KeyingCheckpointRepository(
    input.execSql,
  ).advanceKeyingCheckpointsAtomically({
    access: accessManifestCheckpointAdvances(input),
    documentPurgeCheckpoint: input.documentPurgeCheckpoint,
    organizationId: input.organizationId,
    policies: input.policies,
    authorizationPolicies: input.authorizationPolicies,
    stillCurrent: input.stillCurrent,
    verifiedBundles: input.verifiedBundles,
  });
}

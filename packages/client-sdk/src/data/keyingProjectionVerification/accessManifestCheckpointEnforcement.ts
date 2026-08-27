import {
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  type VerifiedAccessManifestCheckpointEvidence,
} from "@symcrypt/crypto";
import type { DocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import {
  type AccessManifestCheckpointAdvance,
  advanceKeyingCheckpointsAtomically,
} from "../persistence/keyingCheckpointAdvancePersistence";
import type { ExecSql } from "../sqlite/sqlSchema";

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

export async function enforceAccessManifestCheckpoints(input: {
  readonly execSql: ExecSql;
  readonly documentPurgeCheckpoint?: DocumentPurgeCheckpoint | undefined;
  readonly policies: readonly AnyVerifiedPrincipalPolicy[];
  readonly verifiedHeads: readonly VerifiedAccessManifestCheckpointEvidence[];
  readonly verifiedManifests: readonly VerifiedAccessManifestCheckpointEvidence[];
}): Promise<void> {
  await advanceKeyingCheckpointsAtomically({
    access: accessManifestCheckpointAdvances(input),
    documentPurgeCheckpoint: input.documentPurgeCheckpoint,
    execSql: input.execSql,
    policies: input.policies,
  });
}

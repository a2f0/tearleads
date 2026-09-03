import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import {
  observeDependencyFloors,
  type ProjectionCheckpointContext,
} from "./checkpointContext";

type ContainerPathByManifestHash = Map<
  string,
  readonly VerifiedContainerAccessManifest[]
>;

function reconstructVerifiedContainerPath(input: {
  readonly cache: Map<
    string,
    readonly VerifiedContainerAccessManifest[] | null
  >;
  readonly manifestHash: string;
  readonly manifests: ReadonlyMap<string, VerifiedContainerAccessManifest>;
  readonly visiting: Set<string>;
}): readonly VerifiedContainerAccessManifest[] | null {
  const cached = input.cache.get(input.manifestHash);
  if (cached !== undefined) {
    return cached;
  }
  if (input.visiting.has(input.manifestHash)) {
    throw new Error("Verified container history contains a hierarchy cycle");
  }
  const manifest = input.manifests.get(input.manifestHash);
  if (!manifest) {
    input.cache.set(input.manifestHash, null);
    return null;
  }
  const parentManifestHash = manifest.state.parentManifestHash;
  if (parentManifestHash === null) {
    const path = [manifest];
    input.cache.set(input.manifestHash, path);
    return path;
  }

  input.visiting.add(input.manifestHash);
  const parentPath = reconstructVerifiedContainerPath({
    ...input,
    manifestHash: parentManifestHash,
  });
  input.visiting.delete(input.manifestHash);
  const parent = parentPath?.at(-1);
  if (
    !parentPath ||
    !parent ||
    parent.state.containerId !== manifest.state.parentContainerId
  ) {
    input.cache.set(input.manifestHash, null);
    return null;
  }
  const path = [...parentPath, manifest];
  input.cache.set(input.manifestHash, path);
  return path;
}

export function addReconstructedVerifiedContainerPaths(input: {
  readonly containerPathByManifestHash: ContainerPathByManifestHash;
  readonly manifests: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): void {
  const cache = new Map<
    string,
    readonly VerifiedContainerAccessManifest[] | null
  >();
  for (const manifestHash of input.manifests.keys()) {
    const path = reconstructVerifiedContainerPath({
      cache,
      manifestHash,
      manifests: input.manifests,
      visiting: new Set(),
    });
    if (path && !input.containerPathByManifestHash.has(manifestHash)) {
      input.containerPathByManifestHash.set(manifestHash, path);
    }
  }
}

export function resolveEventContainerPaths(input: {
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly dependencyManifestHashes: readonly string[];
  readonly targetManifestHash: string;
}): {
  dependencyContainerPaths: VerifiedContainerAccessManifest[][];
  targetContainerPath: readonly VerifiedContainerAccessManifest[] | undefined;
} {
  return {
    dependencyContainerPaths: input.dependencyManifestHashes
      .map((manifestHash) =>
        input.containerPathByManifestHash.get(manifestHash),
      )
      .filter(
        (path): path is readonly VerifiedContainerAccessManifest[] =>
          path !== undefined,
      )
      .map((path) => [...path]),
    targetContainerPath: input.containerPathByManifestHash.get(
      input.targetManifestHash,
    ),
  };
}

/**
 * Historical link events cite the container manifests that were current when
 * they were signed, so dependency paths are verified without checkpoints. A
 * head event this client has not seen before is different: its authorizing
 * container evidence must not be older than what this client already
 * checkpointed for that container, or a writer revoked from a container could
 * keep authoring links by citing the manifest under which they still had
 * access. This mirrors the principal-policy rule that a post-checkpoint
 * successor must cite the current authority head.
 */
export async function assertHeadDependenciesNotBehindCheckpoints(input: {
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly label: string;
  readonly paths: readonly (
    | readonly VerifiedContainerAccessManifest[]
    | undefined
  )[];
}): Promise<void> {
  // Access along a path is the union of every element's grants, so an
  // inherited grant on a stale ancestor is as usable as one on the leaf:
  // every element is held to the checkpoint, not just the leaf.
  const manifests = new Map<string, VerifiedContainerAccessManifest>();
  for (const path of input.paths) {
    for (const manifest of path ?? []) {
      manifests.set(manifest.manifestHash, manifest);
    }
  }
  for (const manifest of manifests.values()) {
    const checkpoint = await loadAccessManifestCheckpoint(
      input.checkpointContext.execSql,
      "container",
      manifest.state.organizationId,
      manifest.state.containerId,
    );
    if (!checkpoint) {
      continue;
    }
    if (manifest.state.epoch < checkpoint.epoch) {
      throw new KeyingVerificationError(
        "rollback",
        `${input.label} cites container ${manifest.state.containerId} at epoch ${manifest.state.epoch}, behind the local checkpoint at epoch ${checkpoint.epoch}`,
      );
    }
    if (
      manifest.state.epoch === checkpoint.epoch &&
      manifest.manifestHash !== checkpoint.manifestHash
    ) {
      throw new KeyingVerificationError(
        "equivocation",
        `${input.label} cites container ${manifest.state.containerId} at a manifest that conflicts with the local checkpoint`,
      );
    }
  }
  // The read above is an early exit; the same floors are re-checked inside
  // the atomic checkpoint transaction so a concurrent advance cannot slip in
  // between this verification and the commit.
  observeDependencyFloors(
    input.checkpointContext,
    [...manifests.values()].map((manifest) => manifest.checkpoint),
  );
}

import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";

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

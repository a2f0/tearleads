import { computeKeyingDomainHash } from "./canonical";
import { throwVerification } from "./shared";
import type {
  ContainerKeyEpoch,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "./types";

export type ContainerKekParentBinding = Pick<
  VerifiedContainerKekState,
  "containerId" | "containerKeyEpochId" | "keyEpochHash"
>;

function parentLineage(
  parent: VerifiedContainerKekState,
  manifests: ReadonlyMap<string, VerifiedContainerAccessManifest>,
): VerifiedContainerAccessManifest[] {
  const lineage: VerifiedContainerAccessManifest[] = [];
  const seen = new Set<string>();
  let hash: string | null = parent.accessManifestHash;
  while (hash !== null) {
    const manifest = manifests.get(hash);
    if (
      !manifest ||
      manifest.state.containerId !== parent.containerId ||
      seen.has(hash)
    ) {
      throwVerification(
        "missing_dependency",
        "historical parent KEK requires its complete verified lineage",
      );
    }
    seen.add(hash);
    lineage.push(manifest);
    hash = manifest.manifest.previousManifestHash;
  }
  return lineage.reverse();
}

export function creationParentEpochId(
  manifest: VerifiedContainerAccessManifest,
  manifests: ReadonlyMap<string, VerifiedContainerAccessManifest>,
): string | null {
  const parentId = manifest.state.parentContainerId;
  if (parentId === null) return null;
  const hash = manifest.state.parentManifestHash;
  const parent = hash === null ? undefined : manifests.get(hash);
  if (
    !hash ||
    !manifest.event.event.dependencyManifestHashes.includes(hash) ||
    !parent?.state.containerKeyEpochId ||
    parent.manifestHash !== hash ||
    parent.state.containerId !== parentId ||
    parent.state.organizationId !== manifest.state.organizationId
  ) {
    throwVerification(
      "missing_dependency",
      "container KEK creation requires its signed parent citation",
    );
  }
  return parent.state.containerKeyEpochId;
}

/**
 * Reconstruct the pinned epoch from public, verified signed lineage. This is
 * read/recovery evidence: neither the server nor a direct child recipient
 * needs the ancestor's secret key. Writes omit this history and still require
 * the parent's current epoch.
 */
export async function resolveContainerKekParentBinding(input: {
  parent: VerifiedContainerKekState | null;
  pinnedEpochId: string | null;
  verifiedHistory: readonly VerifiedContainerAccessManifest[] | undefined;
}): Promise<ContainerKekParentBinding | null> {
  const { parent } = input;
  if (
    !parent ||
    parent.containerKeyEpochId === input.pinnedEpochId ||
    input.verifiedHistory === undefined
  ) {
    return parent;
  }
  const manifests = new Map(
    input.verifiedHistory.map((manifest) => [manifest.manifestHash, manifest]),
  );
  const lineage = parentLineage(parent, manifests);
  let previousId: string | null = null;
  let keyEpoch = 0;
  let pinned: ContainerKeyEpoch | undefined;
  const seenEpochIds = new Set<string>();
  for (const manifest of lineage) {
    const id = manifest.state.containerKeyEpochId;
    if (!id || id === previousId) continue;
    if (seenEpochIds.has(id)) {
      throwVerification("key_epoch_reuse", "parent lineage reuses a KEK epoch");
    }
    seenEpochIds.add(id);
    previousId = id;
    keyEpoch += 1;
    if (id === input.pinnedEpochId) {
      pinned = {
        id,
        containerId: parent.containerId,
        keyEpoch,
        accessManifestHash: manifest.manifestHash,
        createdByManifestHash: manifest.manifestHash,
        createdByEventHash: manifest.event.eventHash,
        parentContainerKeyEpochId: creationParentEpochId(manifest, manifests),
      };
    }
  }
  if (!pinned || previousId !== parent.containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "child KEK pin is absent from its parent's verified lineage",
    );
  }
  return {
    containerId: parent.containerId,
    containerKeyEpochId: pinned.id,
    keyEpochHash: await computeKeyingDomainHash(
      "tearleads.keying.container-key-epoch",
      { ...pinned },
    ),
  };
}

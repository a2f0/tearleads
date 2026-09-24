import {
  computeContainerKekPublicCommitment,
  isContainerKekMaterialId,
} from "./containerKekMaterial";
import {
  type ContainerKekParentBinding,
  creationParentEpochId,
} from "./containerKekParent";
import { throwVerification } from "./shared";
import type {
  ContainerKeyEpoch,
  VerifiedContainerAccessManifest,
} from "./types";

export function assertContainerKeyEpochManifestBinding(input: {
  readonly keyEpoch: ContainerKeyEpoch;
  readonly parentManifests: readonly VerifiedContainerAccessManifest[];
  readonly manifestByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): void {
  const accessManifest = input.manifestByHash.get(
    input.keyEpoch.accessManifestHash,
  );
  const createdByManifest = input.manifestByHash.get(
    input.keyEpoch.createdByManifestHash,
  );

  if (!accessManifest || !createdByManifest) {
    throwVerification(
      "missing_dependency",
      "container key epoch requires verified creation manifest history",
    );
  }

  if (
    createdByManifest.event.event.eventType === "container.grant" ||
    createdByManifest.event.event.eventType === "container.recite" ||
    [...input.manifestByHash.values()].some(
      (manifest) => manifest.state.epoch < createdByManifest.state.epoch,
    )
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container key epoch creation must be its first signed manifest",
    );
  }

  const signedParentEpochId = creationParentEpochId(
    createdByManifest,
    new Map(
      input.parentManifests.map((manifest) => [
        manifest.manifestHash,
        manifest,
      ]),
    ),
  );
  if (signedParentEpochId !== input.keyEpoch.parentContainerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container key epoch parent does not match its signed creation citation",
    );
  }

  if (createdByManifest.event.eventHash !== input.keyEpoch.createdByEventHash) {
    throwVerification(
      "hash_mismatch",
      "container key epoch created-by event hash does not match manifest",
    );
  }
}

export function assertContainerKeyEpochParentBinding(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly parentKekState: ContainerKekParentBinding | null | undefined;
}): void {
  if (!input.containerManifest.state.parentContainerId) {
    if (input.keyEpoch.parentContainerKeyEpochId !== null) {
      throwVerification(
        "object_mismatch",
        "root container key epoch must not name a parent key epoch",
      );
    }

    return;
  }

  if (!input.parentKekState) {
    throwVerification(
      "missing_dependency",
      "container key epoch requires verified parent KEK state",
    );
  }

  if (
    input.parentKekState.containerId !==
    input.containerManifest.state.parentContainerId
  ) {
    throwVerification(
      "object_mismatch",
      "container key epoch parent state is for the wrong container",
    );
  }

  if (
    input.keyEpoch.parentContainerKeyEpochId !==
    input.parentKekState.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container key epoch parent edge points at the wrong parent key epoch",
    );
  }
}

export async function assertContainerKeyEpochMatchesManifest(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpoch;
}): Promise<void> {
  const containerKeyEpochId = input.containerManifest.state.containerKeyEpochId;

  if (containerKeyEpochId === null) {
    throwVerification(
      "missing_dependency",
      "container KEK state requires a container key epoch id",
    );
  }

  if (!isContainerKekMaterialId(containerKeyEpochId)) {
    throwVerification(
      "invalid_shape",
      "container KEK state requires a material-committing container key epoch id",
    );
  }

  if (input.keyEpoch.id !== containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container KEK state does not match the current access manifest",
    );
  }

  if (
    input.keyEpoch.containerId !== input.containerManifest.state.containerId
  ) {
    throwVerification(
      "object_mismatch",
      "container key epoch belongs to the wrong container",
    );
  }

  const publicKey = input.containerManifest.state.containerKeyPublicKey;
  if (
    publicKey === null ||
    (await computeContainerKekPublicCommitment({
      containerId: input.keyEpoch.containerId,
      keyEpoch: input.keyEpoch.keyEpoch,
      containerKeyPublicKey: publicKey,
    })) !== containerKeyEpochId
  ) {
    throwVerification(
      "hash_mismatch",
      "container KEK public key does not match its epoch commitment",
    );
  }
}

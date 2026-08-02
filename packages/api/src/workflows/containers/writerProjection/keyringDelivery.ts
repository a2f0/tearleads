import type { ContainerKekKeyring } from "@tearleads/crypto";
import { computeContainerKeyEpochHash } from "@tearleads/crypto";
import type { HistoricalContainerKeyEpochResponse } from "@tearleads/validators/response";
import { getContainerKeyEpochById } from "../../../access/read/containerKekStore";
import { containerKeyEpochRecord, stripContainerKeyEpoch } from "./records";
import {
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "./types";

/**
 * Loads the sealed keyring for the epoch a projection serves. The write path
 * stores a keyring with every rotation, so absence past epoch 1 is storage
 * corruption and fails closed rather than degrading.
 */
export async function loadContainerKekKeyring(input: {
  readonly containerKeyEpochId: string;
  readonly context: ContainerWriterProjectionContext;
}): Promise<ContainerKekKeyring | null> {
  const epoch = await getContainerKeyEpochById(
    input.containerKeyEpochId,
    input.context.executor,
  );
  if (!epoch) {
    throw new ContainerWriterProjectionError("Container KEK missing", 409);
  }
  if (epoch.keyEpoch === 1) {
    if (epoch.keyring !== null) {
      throw new ContainerWriterProjectionError(
        "Initial container KEK epoch cannot have a keyring",
        409,
      );
    }
    return null;
  }
  if (epoch.keyring === null) {
    throw new ContainerWriterProjectionError(
      "Container KEK keyring missing",
      409,
    );
  }
  return epoch.keyring;
}

/**
 * Loads the epoch record a descendant path entry pins as its
 * `parentContainerKeyEpochId`. This is the only reason historical epoch
 * records ride the hot wire: content-key envelopes address epochs by id
 * alone, but a child's parent wrap binds to the parent epoch's record hash.
 */
export async function loadHistoricalContainerKeyEpoch(input: {
  readonly containerKeyEpochId: string;
  readonly context: ContainerWriterProjectionContext;
  readonly expectedContainerId: string;
}): Promise<HistoricalContainerKeyEpochResponse> {
  const epoch = await getContainerKeyEpochById(
    input.containerKeyEpochId,
    input.context.executor,
  );
  if (!epoch || epoch.containerId !== input.expectedContainerId) {
    throw new ContainerWriterProjectionError(
      "Container KEK historical epoch missing",
      409,
    );
  }
  const keyEpoch = stripContainerKeyEpoch(epoch);
  return {
    accessManifestHash: epoch.accessManifestHash,
    containerId: epoch.containerId,
    containerKeyEpoch: epoch.keyEpoch,
    containerKeyEpochId: epoch.id,
    keyEpoch: containerKeyEpochRecord(keyEpoch),
    keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
    parentContainerKeyEpochId: epoch.parentContainerKeyEpochId,
  };
}

import type { ContainerKekKeyring } from "@tearleads/crypto";
import { getContainerKeyEpochWithKeyring } from "../../../access/read/containerKekStore";
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
  // Generic epoch lookups omit the keyring blob; this is one of the few paths
  // that genuinely needs it, so it reads the epoch row with its keyring once.
  const epoch = await getContainerKeyEpochWithKeyring(
    input.containerKeyEpochId,
    input.context.executor,
  );
  if (!epoch) {
    throw new ContainerWriterProjectionError("Container KEK missing", 409);
  }
  const { keyring } = epoch;
  if (epoch.keyEpoch === 1) {
    if (keyring !== null) {
      throw new ContainerWriterProjectionError(
        "Initial container KEK epoch cannot have a keyring",
        409,
      );
    }
    return null;
  }
  if (keyring === null) {
    throw new ContainerWriterProjectionError(
      "Container KEK keyring missing",
      409,
    );
  }
  return keyring;
}

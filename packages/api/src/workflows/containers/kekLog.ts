import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import { listContainerKeyEpochs } from "../../access/read/containerKekStore";
import { resolveContainerAccessProjection } from "./writerProjection";
import { createContainerWriterProjectionContext } from "./writerProjection/context";
import { ContainerWriterProjectionError } from "./writerProjection/types";

/**
 * Serves the append-only rotation log — every epoch with its write-once
 * bridge and sealed keyring — for keyring rebuild and repair. Current read
 * access is history-inclusive, so the whole log is in scope for any reader.
 */
export async function runContainerKekLogWorkflow(
  db: ApiDatabase,
  input: {
    readonly containerId: string;
    readonly userId: string;
  },
): Promise<ContainerKekLogResponse> {
  return db.transaction(async (tx) => {
    const context = createContainerWriterProjectionContext(tx);
    await resolveContainerAccessProjection({
      containerId: input.containerId,
      context,
      executor: tx,
      minimumAccessLevel: "read",
      userId: input.userId,
    });

    const epochs = await listContainerKeyEpochs(input.containerId, tx);
    if (epochs.length === 0) {
      throw new ContainerWriterProjectionError("Container not found", 404);
    }

    return {
      containerId: input.containerId,
      epochs: epochs.map((epoch) => ({
        accessManifestHash: epoch.accessManifestHash,
        bridge: epoch.predecessorBridge ? { ...epoch.predecessorBridge } : null,
        containerKeyEpoch: epoch.keyEpoch,
        containerKeyEpochId: epoch.id,
        keyring: epoch.keyring ? { ...epoch.keyring } : null,
        parentContainerKeyEpochId: epoch.parentContainerKeyEpochId,
      })),
    };
  });
}

import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import {
  listContainerKeyEpochs,
  listContainerKeyWraps,
} from "../../access/read/containerKekStore";
import { resolveContainerAccessProjection } from "./writerProjection";
import { createContainerWriterProjectionContext } from "./writerProjection/context";
import { ContainerWriterProjectionError } from "./writerProjection/types";

/**
 * Serves the append-only rotation log — every epoch with its write-once
 * bridge and retained recipient envelopes — for keyring rebuild and repair.
 * Current read access is history-inclusive, so the whole log is in scope for
 * any reader. The historical wraps are the severed-bridge backstop: a member
 * present at an epoch recovers its KEK from their own envelope regardless of
 * what later rotators wrote.
 *
 * Historical keyrings (the fallback ladder for mixed corruption) are served
 * only on request: each retained keyring is O(its epoch) bytes, so shipping
 * all of them is O(epochs²) — the log stays O(epochs) by default, the same
 * order as one projection. `keyring: null` therefore means "not requested or
 * epoch 1" unless `includeKeyrings` was set.
 */
export async function runContainerKekLogWorkflow(
  db: ApiDatabase,
  input: {
    readonly containerId: string;
    readonly includeKeyrings: boolean;
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

    const logEpochs: ContainerKekLogResponse["epochs"] = [];
    for (const epoch of epochs) {
      const wraps = await listContainerKeyWraps(epoch.id, tx);
      logEpochs.push({
        accessManifestHash: epoch.accessManifestHash,
        bridge: epoch.predecessorBridge ? { ...epoch.predecessorBridge } : null,
        containerKeyEpoch: epoch.keyEpoch,
        containerKeyEpochId: epoch.id,
        keyring:
          input.includeKeyrings && epoch.keyring ? { ...epoch.keyring } : null,
        parentContainerKeyEpochId: epoch.parentContainerKeyEpochId,
        wraps: wraps.map((wrap) => ({
          containerKeyEpochId: wrap.containerKeyEpochId,
          recipientKind: wrap.recipientKind,
          recipientId: wrap.recipientId,
          recipientKeyEpochId: wrap.recipientKeyEpochId,
          recipientKeyFingerprint: wrap.recipientKeyFingerprint,
          kemCipherText: wrap.kemCipherText,
          wrappedKey: wrap.wrappedKey,
          wrapManifestHash: wrap.wrapManifestHash,
        })),
      });
    }

    return { containerId: input.containerId, epochs: logEpochs };
  });
}

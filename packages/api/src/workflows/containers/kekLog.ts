import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import { CONTAINER_KEK_LOG_PAGE_LIMIT } from "@tearleads/validators/util";
import {
  listContainerKeyEpochs,
  listContainerKeyWrapsByEpochId,
} from "../../access/read/containerKekStore";
import { resolveContainerAccessProjection } from "./writerProjection";
import { createContainerWriterProjectionContext } from "./writerProjection/context";
import { ContainerWriterProjectionError } from "./writerProjection/types";

/**
 * Serves the append-only rotation log — each epoch with its write-once bridge
 * and retained recipient envelopes — for keyring rebuild and repair. Current
 * read access is history-inclusive, so the whole log is in scope for any
 * reader. The historical wraps are the severed-bridge backstop: a member
 * present at an epoch recovers its KEK from their own envelope regardless of
 * what later rotators wrote.
 *
 * Bounded by construction. A page is at most `CONTAINER_KEK_LOG_PAGE_LIMIT`
 * epochs, walked from `afterKeyEpoch`, with all of a page's wraps loaded in
 * one query. Each retained keyring is O(its epoch) bytes, so serving them all
 * would be O(epochs²); they ship only when `includeKeyrings` is set, and only
 * for the requested page. `keyring: null` therefore means "not requested, or
 * epoch 1" rather than "absent".
 */
export async function runContainerKekLogWorkflow(
  db: ApiDatabase,
  input: {
    readonly afterKeyEpoch: number;
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

    const allEpochs = await listContainerKeyEpochs(input.containerId, tx);
    if (allEpochs.length === 0) {
      throw new ContainerWriterProjectionError("Container not found", 404);
    }

    const remaining = allEpochs.filter(
      (epoch) => epoch.keyEpoch > input.afterKeyEpoch,
    );
    const page = remaining.slice(0, CONTAINER_KEK_LOG_PAGE_LIMIT);
    const wrapsByEpochId = await listContainerKeyWrapsByEpochId(
      page.map((epoch) => epoch.id),
      tx,
    );

    return {
      containerId: input.containerId,
      hasMore: remaining.length > page.length,
      epochs: page.map((epoch) => ({
        accessManifestHash: epoch.accessManifestHash,
        bridge: epoch.predecessorBridge ? { ...epoch.predecessorBridge } : null,
        containerKeyEpoch: epoch.keyEpoch,
        containerKeyEpochId: epoch.id,
        keyring:
          input.includeKeyrings && epoch.keyring ? { ...epoch.keyring } : null,
        parentContainerKeyEpochId: epoch.parentContainerKeyEpochId,
        wraps: (wrapsByEpochId.get(epoch.id) ?? []).map((wrap) => ({
          containerKeyEpochId: wrap.containerKeyEpochId,
          recipientKind: wrap.recipientKind,
          recipientId: wrap.recipientId,
          recipientKeyEpochId: wrap.recipientKeyEpochId,
          recipientKeyFingerprint: wrap.recipientKeyFingerprint,
          kemCipherText: wrap.kemCipherText,
          wrappedKey: wrap.wrappedKey,
          wrapManifestHash: wrap.wrapManifestHash,
        })),
      })),
    };
  });
}

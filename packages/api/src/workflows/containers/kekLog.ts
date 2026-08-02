import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import { CONTAINER_KEK_LOG_PAGE_LIMIT } from "@tearleads/validators/util";
import {
  getContainerKeyEpochKeyring,
  getCurrentContainerKeyEpoch,
  listContainerKeyEpochPage,
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
 * Bounded in SQL, not after the fact: a page is at most
 * `CONTAINER_KEK_LOG_PAGE_LIMIT` epochs selected with `LIMIT`, walked from
 * `afterKeyEpoch`, with all of a page's wraps loaded in one query.
 *
 * A retained keyring is O(its epoch) bytes — megabytes near the epoch cap —
 * so `includeKeyrings` serves **at most one**, for the page's first epoch,
 * and the column is not selected at all otherwise. The ladder fallback wants
 * exactly one historical keyring at a time, so recovery walks it with the
 * `afterKeyEpoch` cursor rather than pulling the whole ladder. That keeps the
 * worst-case response one keyring plus one page of bridges and wraps, instead
 * of the quadratic total. `keyring: null` therefore means "not requested,
 * not this page's first epoch, or epoch 1" rather than "absent".
 *
 * Wraps are filtered to what the requester could actually use as a recovery
 * anchor: their own direct envelopes, principal-addressed ones (whose
 * principal ids current readers already see in the signed manifests on their
 * access path), and parent-container envelopes — the only anchor an
 * inherited-only child has, recovered by holding the parent epoch's KEK.
 * Other members' identities are never disclosed, preserving the "superseded
 * recipient envelopes are not served" guarantee for everyone but the
 * requester themselves.
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

    // One indexed lookup proves the container has key history at all; the
    // page query below never loads more than a page.
    if (!(await getCurrentContainerKeyEpoch(input.containerId, tx))) {
      throw new ContainerWriterProjectionError("Container not found", 404);
    }

    const { epochs: page, hasMore } = await listContainerKeyEpochPage(
      {
        afterKeyEpoch: input.afterKeyEpoch,
        containerId: input.containerId,
        limit: CONTAINER_KEK_LOG_PAGE_LIMIT,
      },
      tx,
    );
    // Exactly one keyring blob is ever read, and only when asked for.
    const firstEpochId = page[0]?.id;
    const requestedKeyring =
      input.includeKeyrings && firstEpochId
        ? await getContainerKeyEpochKeyring(firstEpochId, tx)
        : null;
    const wrapsByEpochId = await listContainerKeyWrapsByEpochId(
      page.map((epoch) => epoch.id),
      tx,
    );

    return {
      containerId: input.containerId,
      hasMore,
      epochs: page.map((epoch, pageIndex) => ({
        accessManifestHash: epoch.accessManifestHash,
        bridge: epoch.predecessorBridge ? { ...epoch.predecessorBridge } : null,
        containerKeyEpoch: epoch.keyEpoch,
        containerKeyEpochId: epoch.id,
        keyring:
          pageIndex === 0 && requestedKeyring ? { ...requestedKeyring } : null,
        parentContainerKeyEpochId: epoch.parentContainerKeyEpochId,
        wraps: (wrapsByEpochId.get(epoch.id) ?? [])
          .filter(
            (wrap) =>
              wrap.recipientKind === "container" ||
              wrap.recipientKind === "group" ||
              wrap.recipientKind === "organization" ||
              (wrap.recipientKind === "user" &&
                wrap.recipientId === input.userId),
          )
          .map((wrap) => ({
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

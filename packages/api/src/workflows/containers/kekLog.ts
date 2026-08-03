import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ContainerKekKeyring } from "@tearleads/crypto";
import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import { CONTAINER_KEK_LOG_PAGE_LIMIT } from "@tearleads/validators/util";
import {
  getContainerKeyEpochKeyring,
  getContainerKeyEpochsById,
  getCurrentContainerKeyEpoch,
  listContainerKeyEpochPage,
  listContainerKeyWrapsByEpochId,
} from "../../access/read/containerKekStore";
import { resolveContainerAccessProjection } from "./writerProjection";

type StoredWrap =
  Awaited<ReturnType<typeof listContainerKeyWrapsByEpochId>> extends Map<
    string,
    infer Wrap
  >
    ? Wrap extends readonly (infer Item)[]
      ? Item
      : never
    : never;

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
 * so at most one is ever served, named explicitly by `keyringForEpoch`, and
 * the column is not selected at all otherwise. The ladder fallback wants one
 * specific historical keyring at a time, so it asks for that epoch rather
 * than paging through blobs. `keyring: null` therefore means "not the
 * requested epoch, or epoch 1" rather than "absent".
 *
 * Wraps are filtered to what the requester could actually use as a recovery
 * anchor: their own direct envelopes, envelopes for principals named on their
 * own resolved access path (so a removed group's retained envelopes are not
 * disclosed to somebody who was never in it), and parent-container envelopes — the only anchor an
 * inherited-only child has, recovered by holding the parent epoch's KEK.
 * Other members' identities are never disclosed, preserving the "superseded
 * recipient envelopes are not served" guarantee for everyone but the
 * requester themselves.
 */
function logEpochResponse(input: {
  epoch: Awaited<
    ReturnType<typeof listContainerKeyEpochPage>
  >["epochs"][number];
  keyring: ContainerKekKeyring | null;
  wraps: readonly StoredWrap[];
}): ContainerKekLogResponse["epochs"][number] {
  return {
    accessManifestHash: input.epoch.accessManifestHash,
    bridge: input.epoch.predecessorBridge
      ? { ...input.epoch.predecessorBridge }
      : null,
    containerKeyEpoch: input.epoch.keyEpoch,
    containerKeyEpochId: input.epoch.id,
    keyring: input.keyring ? { ...input.keyring } : null,
    parentContainerKeyEpochId: input.epoch.parentContainerKeyEpochId,
    wraps: input.wraps.map((wrap) => ({
      containerKeyEpochId: wrap.containerKeyEpochId,
      recipientKind: wrap.recipientKind,
      recipientId: wrap.recipientId,
      recipientKeyEpochId: wrap.recipientKeyEpochId,
      recipientKeyFingerprint: wrap.recipientKeyFingerprint,
      kemCipherText: wrap.kemCipherText,
      wrappedKey: wrap.wrappedKey,
      wrapManifestHash: wrap.wrapManifestHash,
    })),
  };
}

export async function runContainerKekLogWorkflow(
  db: ApiDatabase,
  input: {
    readonly afterKeyEpoch: number;
    readonly containerId: string;
    readonly keyringForEpoch: number;
    readonly userId: string;
  },
): Promise<ContainerKekLogResponse> {
  return db.transaction(async (tx) => {
    const context = createContainerWriterProjectionContext(tx);
    const access = await resolveContainerAccessProjection({
      containerId: input.containerId,
      context,
      executor: tx,
      minimumAccessLevel: "read",
      userId: input.userId,
    });

    // Principals that actually AUTHORIZE this requester — membership, not
    // mere reference. A group they were never in, or one that no longer
    // covers them, is not an anchor they could use, so serving its retained
    // envelopes would disclose history for nothing.
    const authorizedPrincipals = access.principalPolicies
      .filter((policy) =>
        policy.projection.some((member) => member.userId === input.userId),
      )
      .map((policy) => ({
        principalId: policy.principalId,
        principalType: policy.principalType,
      }));

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
    // Exactly one keyring blob is ever read, for the epoch named by the
    // caller, and only when it is on this page.
    const requestedEpoch = page.find(
      (epoch) => epoch.keyEpoch === input.keyringForEpoch,
    );
    const requestedKeyring = requestedEpoch
      ? await getContainerKeyEpochKeyring(requestedEpoch.id, tx)
      : null;
    // Scope applied in SQL: the page never materializes envelopes the
    // requester could not use as an anchor.
    // One batched lookup: a full page would otherwise issue a query per
    // epoch just to name its parent container.
    const parentEpochIds = [
      ...new Set(
        page
          .map((epoch) => epoch.parentContainerKeyEpochId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const historicalParentContainerIds = [
      ...(await getContainerKeyEpochsById(parentEpochIds, tx)).values(),
    ].map((epoch) => epoch.containerId);

    const wrapsByEpochId = await listContainerKeyWrapsByEpochId(
      page.map((epoch) => epoch.id),
      tx,
      {
        authorizedPrincipals,
        // Ancestors on the requester's own resolved path, plus the parents
        // historical epochs actually inherited from: after a move, an
        // inherited-only container's older epochs are anchored by the OLD
        // parent, and dropping those envelopes would strand recovery across
        // a severed move bridge. Every id here is one this requester's own
        // key history already names.
        parentContainerIds: [
          ...new Set([
            ...access.verifiedPath.map(
              (manifest) => manifest.state.containerId,
            ),
            ...historicalParentContainerIds,
          ]),
        ],
        userId: input.userId,
      },
    );

    return {
      containerId: input.containerId,
      hasMore,
      epochs: page.map((epoch) =>
        logEpochResponse({
          epoch,
          keyring: epoch.id === requestedEpoch?.id ? requestedKeyring : null,
          wraps: wrapsByEpochId.get(epoch.id) ?? [],
        }),
      ),
    };
  });
}

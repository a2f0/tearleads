import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  lockAccessManifestHeadsForShare,
  lockUnheldAccessManifestHeads,
} from "../../../access/read/accessManifestStore";
import {
  type DocumentLinkSetFrontier,
  resolveCurrentDocumentKekTargets,
} from "../../../access/read/documentKekTargets";
import { documentSyncStateStale } from "./errors";

/** Container head rows read by the lock that still holds them. */
export type LockedContainerHeads = Awaited<
  ReturnType<typeof lockUnheldAccessManifestHeads>
>;

/**
 * Serialize an old-head sync write against a concurrent link-set rotation.
 * The lock set covers every authorizing ancestor head, not only the directly
 * linked targets: the write-authorization proof walks full container paths,
 * and an unlocked ancestor would let a concurrent access mutation (e.g. a
 * root revoke) commit under an in-flight write it no longer authorizes.
 * Container heads FOR SHARE before the document head keeps the global
 * container->document lock order shared with the link-set mutation path.
 * The KEK targets are resolved strictly here, once, under those locks. Heads
 * this transaction already holds (a create's seed) are not locked again, and
 * the container head rows the lock read are returned for the write proof.
 */
export async function lockSyncDocumentWriteFrontier(input: {
  readonly authorizingContainerIds: readonly string[];
  readonly documentId: string;
  readonly frontier: Pick<
    DocumentLinkSetFrontier,
    "linkSetManifestHash" | "linkedContainerIds"
  >;
  readonly tx: DatabaseTransaction;
}): Promise<{
  readonly lockedContainerHeads: LockedContainerHeads;
  readonly targets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
}> {
  const lockedContainerHeads = await lockUnheldAccessManifestHeads(
    "container",
    [...input.frontier.linkedContainerIds, ...input.authorizingContainerIds],
    input.tx,
    "share",
  );
  await lockUnheldAccessManifestHeads(
    "document",
    [input.documentId],
    input.tx,
    "update",
  );
  const lockedTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
  );
  if (
    lockedTargets.linkSetManifestHash !== input.frontier.linkSetManifestHash
  ) {
    throw documentSyncStateStale("Document manifest is stale");
  }
  return { lockedContainerHeads, targets: lockedTargets };
}

/**
 * Freeze a pagination watermark behind every update insert for this document.
 * Writers take the same exclusive head lock before PostgreSQL allocates their
 * identity sequence, so a lower sequence can never commit after the watermark
 * reader has advanced past it.
 */
export async function lockSyncDocumentPullWatermark(input: {
  readonly documentId: string;
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  await lockAccessManifestHeadsForShare(
    "document",
    [input.documentId],
    input.tx,
  );
}

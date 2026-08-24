import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import {
  lockAccessManifestHeadsForShare,
  lockAccessManifestHeadsForUpdate,
} from "../../../access/read/accessManifestStore";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import { documentSyncStateStale } from "./errors";

/**
 * Serialize an old-head sync write against a concurrent link-set rotation.
 * The lock set covers every authorizing ancestor head, not only the directly
 * linked targets: the write-authorization proof walks full container paths,
 * and an unlocked ancestor would let a concurrent access mutation (e.g. a
 * root revoke) commit under an in-flight write it no longer authorizes.
 * Container heads FOR SHARE before the document head keeps the global
 * container->document lock order shared with the link-set mutation path.
 */
export async function lockSyncDocumentWriteFrontier(input: {
  readonly authorizingContainerIds: readonly string[];
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly documentId: string;
  readonly tx: DatabaseTransaction;
}): Promise<Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>> {
  await lockAccessManifestHeadsForShare(
    "container",
    [
      ...input.currentTargets.targets.map((target) => target.containerId),
      ...input.authorizingContainerIds,
    ],
    input.tx,
  );
  await lockAccessManifestHeadsForUpdate(
    "document",
    [input.documentId],
    input.tx,
  );
  const lockedTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
  );
  if (
    lockedTargets.linkSetManifestHash !==
    input.currentTargets.linkSetManifestHash
  ) {
    throw documentSyncStateStale("Document manifest is stale");
  }
  return lockedTargets;
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

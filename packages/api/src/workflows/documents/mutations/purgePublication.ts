import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containerDocumentSyncTombstones } from "@tearleads/api-shared/schema";
import { touchContainers } from "./shared/documentRows";

/**
 * Publishes a purge to the clients that held the document. The tombstone
 * tells the container's document lane that the document is gone. It changes
 * what that lane returns, so the container is republished in the lane that
 * serves it, like every other write to its documents: a client that lost the
 * purge's hint then finds the lane moved from the tree, without listing
 * every document lane it knows.
 */
export async function publishDocumentPurge(input: {
  readonly containerId: string;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly updatedAt: Date;
}): Promise<void> {
  await input.executor
    .insert(containerDocumentSyncTombstones)
    .values({
      containerId: input.containerId,
      documentId: input.documentId,
      updatedAt: input.updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        containerDocumentSyncTombstones.containerId,
        containerDocumentSyncTombstones.documentId,
      ],
      set: { updatedAt: input.updatedAt },
    });
  await touchContainers(input.executor, [input.containerId], input.updatedAt);
}

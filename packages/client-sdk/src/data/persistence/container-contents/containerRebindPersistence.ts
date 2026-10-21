import { eq } from "drizzle-orm";
import { containers, dormantContainerMetadata } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import { rebindDocumentRowInTransaction } from "../documents/records/documentRowsInTransaction";
import type { HeldContainerBinding } from "./containerBinding";
import { loadStoredHeldContainerBinding } from "./containerHydrationPersistence";
import { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";
import {
  isSupersededContainerBinding,
  recordSupersededContainerBindingsInTransaction,
} from "./supersededContainerBindings";

function sameBinding(
  current: HeldContainerBinding | null,
  expected: HeldContainerBinding,
): boolean {
  return (
    current?.organizationId === expected.organizationId &&
    current.metadataDocumentId === expected.metadataDocumentId
  );
}

/**
 * Move a held folder to the binding its own user re-created it under: purged
 * organization recovery re-homes folders under their existing ids. Local
 * content and queued edits follow, as they do on the recovering device, and
 * the metadata record's remote stream starts over at the new target. An
 * already-applied re-home succeeds; any other change to the held binding since
 * it was read returns false and changes nothing.
 */
export async function rebindStoredHeldContainer(
  execSql: ExecSql,
  input: {
    containerId: string;
    expected: HeldContainerBinding;
    next: { metadataDocumentId: string; organizationId: string };
    stillCurrent?: (() => boolean) | undefined;
  },
): Promise<boolean> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    const outcome = await getClientSQLitePersistenceRuntime(
      lockedExecSql,
    ).guardedTransaction(
      async (tx) => {
        const current = await loadStoredHeldContainerBinding(
          lockedExecSql,
          input.containerId,
        );
        const { metadataDocumentId, organizationId } = input.next;
        // Another store over this database may have applied the same re-home.
        if (sameBinding(current, { metadataDocumentId, organizationId }))
          return true;
        if (!sameBinding(current, input.expected)) return false;
        // A purged organization never returns; binding back is a replay.
        if (
          await isSupersededContainerBinding(lockedExecSql, {
            containerId: input.containerId,
            organizationId,
          })
        )
          return false;
        const supersededAt = new Date().toISOString();
        if (input.expected.organizationId !== organizationId) {
          await recordSupersededContainerBindingsInTransaction(tx, {
            containerIds: [input.containerId],
            organizationId: input.expected.organizationId,
            supersededAt,
          });
        }
        // The old stream's clock cannot order listings of the new one.
        await tx
          .update(containers)
          .set({ metadataDocumentId, organizationId, serverUpdatedAt: null })
          .where(eq(containers.id, input.containerId))
          .run();
        await tx
          .update(dormantContainerMetadata)
          .set({ organizationId })
          .where(eq(dormantContainerMetadata.containerId, input.containerId))
          .run();
        await rebindDocumentRowInTransaction(
          tx,
          { appKind: CONTAINER_METADATA_APP_KIND, localId: input.containerId },
          { documentId: metadataDocumentId, updatedAt: supersededAt },
        );
        return true;
      },
      () => !input.stillCurrent || input.stillCurrent(),
      { behavior: "immediate" },
    );
    return outcome.committed && outcome.result === true;
  });
}

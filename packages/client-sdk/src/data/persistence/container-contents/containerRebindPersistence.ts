import { and, eq } from "drizzle-orm";
import type { HeldContainerBinding } from "../../containers/containerBinding";
import {
  containers,
  documents,
  dormantContainerMetadata,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import { loadStoredHeldContainerBinding } from "./containerHydrationPersistence";
import { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

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
        await tx
          .update(documents)
          .set({
            accessEpoch: 1,
            accessStateHash: null,
            contentKeyBundle: null,
            documentId: metadataDocumentId,
            documentKekTargets: null,
            documentManifestBundle: null,
            lastCommitLsn: null,
            pullContinuation: null,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
              eq(documents.localId, input.containerId),
            ),
          )
          .run();
        return true;
      },
      () => !input.stillCurrent || input.stillCurrent(),
      { behavior: "immediate" },
    );
    return outcome.committed && outcome.result === true;
  });
}

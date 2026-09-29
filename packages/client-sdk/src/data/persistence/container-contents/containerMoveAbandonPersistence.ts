import { eq } from "drizzle-orm";
import { containerProjection, containers } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import type { ContainerMoveIntentRevisionInput } from "./containerContentsPersistenceTypes";
import { deleteContainerMoveIntentRevision } from "./containerIntentPersistence";

/**
 * Drop a queued move the server will never accept and put the folder back
 * under the parent it left, atomically. The server row never changed, so no
 * listing would ever restore the placement. Returns false, changing nothing,
 * when a newer local move superseded the revision.
 */
export async function abandonStoredMoveIntentRevision(
  execSql: ExecSql,
  input: ContainerMoveIntentRevisionInput & {
    previousParentContainerId: string;
  },
): Promise<boolean> {
  const outcome = await getClientSQLitePersistenceRuntime(
    execSql,
  ).guardedTransaction(
    async (tx) => {
      if (!(await deleteContainerMoveIntentRevision({ ...input, tx })))
        return false;
      await tx
        .update(containers)
        .set({ parentId: input.previousParentContainerId })
        .where(eq(containers.id, input.containerId))
        .run();
      await tx
        .update(containerProjection)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(containerProjection.containerId, input.containerId))
        .run();
      return true;
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  return outcome.committed && outcome.result === true;
}

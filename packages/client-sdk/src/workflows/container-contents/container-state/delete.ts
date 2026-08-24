import type { ContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { deleteRemoteContainer } from "./remote";
import type { ContainerWorkflowRuntime } from "./types";

export async function deleteContainerState(input: {
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerWorkflowRuntime;
}): Promise<boolean> {
  const isRemoteContainer = Boolean(input.containerState.record.documentId);
  let deletedAt: string | undefined;

  if (isRemoteContainer) {
    const deletedRemoteContainer = await deleteRemoteContainer({
      containerId: input.containerState.container.id,
      runtime: input.runtime,
    });
    if (!deletedRemoteContainer) {
      return false;
    }
    deletedAt = deletedRemoteContainer.deletedAt;
  }
  const execSql = input.runtime.infra.execSql;

  await input.persistence.deleteContainer(
    execSql,
    input.containerState.container.id,
    deletedAt ? { updatedAt: deletedAt } : undefined,
  );
  return true;
}

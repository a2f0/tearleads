import {
  deleteSingleExplorerContainer,
  type ExplorerPersistence,
} from "../containerPersistence";
import type { ExplorerContainerState } from "../remoteHydration";
import { getExplorerWorkflowRuntimeExecSql } from "../runtime";
import { deleteRemoteExplorerContainer } from "./remote";
import type { ExplorerContainerWorkflowRuntime } from "./types";

export async function deleteExplorerContainerState(input: {
  containerState: ExplorerContainerState;
  persistence: ExplorerPersistence;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<boolean> {
  const isRemoteContainer = Boolean(input.containerState.record.documentId);

  if (isRemoteContainer) {
    const deletedRemoteContainer = await deleteRemoteExplorerContainer({
      containerId: input.containerState.container.id,
      runtime: input.runtime,
    });
    if (!deletedRemoteContainer) {
      return false;
    }
  }
  const execSql = getExplorerWorkflowRuntimeExecSql(input.runtime);

  await deleteSingleExplorerContainer(
    execSql,
    input.persistence,
    input.containerState.container.id,
  );
  return true;
}

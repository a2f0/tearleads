import {
  type ContainerContentsPersistence,
  deleteSingleContainer,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { deleteRemoteContainer } from "./remote";
import type { ContainerWorkflowRuntime } from "./types";

export async function deleteContainerState(input: {
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerWorkflowRuntime;
}): Promise<boolean> {
  const isRemoteContainer = Boolean(input.containerState.record.documentId);

  if (isRemoteContainer) {
    const deletedRemoteContainer = await deleteRemoteContainer({
      containerId: input.containerState.container.id,
      runtime: input.runtime,
    });
    if (!deletedRemoteContainer) {
      return false;
    }
  }
  const execSql = input.runtime.execSql;

  await deleteSingleContainer(
    execSql,
    input.persistence,
    input.containerState.container.id,
  );
  return true;
}

import type { ContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { deleteRemoteContainer } from "./remote";
import type { ContainerWorkflowRuntime } from "./types";

type DeleteContainerStateResult =
  | "deleted"
  | "local-conflict"
  | "remote-deleted"
  | "remote-failed";

export async function deleteContainerState(input: {
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<DeleteContainerStateResult> {
  const isRemoteContainer = Boolean(input.containerState.record.documentId);
  let deletedAt: string | undefined;

  if (isRemoteContainer) {
    const deletedRemoteContainer = await deleteRemoteContainer({
      containerId: input.containerState.container.id,
      organizationId: input.containerState.container.organizationId,
      runtime: input.runtime,
    });
    if (!deletedRemoteContainer) {
      return "remote-failed";
    }
    deletedAt = deletedRemoteContainer.deletedAt;
  }
  const execSql = input.runtime.infra.execSql;
  const containerId = input.containerState.container.id;
  const deletedContainerIds = await input.persistence.deleteContainers(
    execSql,
    [
      {
        containerId,
        reason: "deleted",
        updatedAt: deletedAt ?? new Date().toISOString(),
      },
    ],
    {
      expectedContainers: [
        { containerId, expectedContainer: input.containerState.container },
      ],
      stillCurrent: input.stillCurrent,
    },
  );
  if (deletedContainerIds.includes(containerId)) return "deleted";
  return isRemoteContainer ? "remote-deleted" : "local-conflict";
}

import type { ContainerContentsPersistence } from "./containerPersistence";
import type { ContainerState } from "./remoteHydration";
import type { ContainerContentsWorkflowSqlRuntime } from "./runtime";
import { hydrateStoredContainerState } from "./storedContainerState";

type LocalContainerStateRuntime = ContainerContentsWorkflowSqlRuntime;

export async function loadLocalContainerStates(input: {
  isCurrent?: (() => boolean) | undefined;
  persistence: ContainerContentsPersistence;
  runtime: LocalContainerStateRuntime;
}): Promise<ReadonlyArray<ContainerState>> {
  const { persistence, runtime } = input;
  const execSql = runtime.infra.execSql;
  await persistence.ensureSchema(execSql);
  const storedContainers = await persistence.loadContainers(execSql);

  const containerStates: ContainerState[] = [];
  for (const storedContainer of storedContainers) {
    if (input.isCurrent?.() === false) break;
    containerStates.push(
      await hydrateStoredContainerState({
        execSql,
        isCurrent: input.isCurrent,
        persistence,
        storedContainer,
      }),
    );
  }

  return containerStates;
}

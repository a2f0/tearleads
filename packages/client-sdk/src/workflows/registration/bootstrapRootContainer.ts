import {
  ensureContainerTables,
  loadContainers,
  saveContainer,
} from "../../data/persistence/containers/containerPersistence";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";

interface RootContainerBootstrapResult {
  containerId: string;
  created: boolean;
}

async function bootstrapRootContainerFromExecSql(
  execSql: ExecSql,
): Promise<RootContainerBootstrapResult> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureContainerTables(lockedExecSql);
    const containers = await loadContainers(lockedExecSql);
    const root = containers.find((container) => container.parentId === null);

    if (root) {
      return {
        containerId: root.id,
        created: false,
      };
    }

    const containerId = crypto.randomUUID();
    await saveContainer(lockedExecSql, {
      id: containerId,
      organizationId: "",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    return {
      containerId,
      created: true,
    };
  });
}

export async function bootstrapRootContainer(
  input: ExecSql | ExecSqlClientLike,
): Promise<RootContainerBootstrapResult> {
  return bootstrapRootContainerFromExecSql(
    typeof input === "function" ? input : createExecSql(input),
  );
}

import { deriveStableUuidV4Shaped } from "../../data/keying/stableUuid";
import {
  ensureContainerTables,
  loadContainers,
  saveContainer,
} from "../../data/persistence/container-contents/containerPersistence";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";

// A device-first root can receive deleted items before its organization is registered.
const ORGANIZATION_ID_NAMESPACE = new Uint8Array([
  0x62, 0xb5, 0x73, 0xbf, 0x47, 0x2a, 0x4f, 0x93, 0x87, 0xcf, 0x07, 0x8e, 0x25,
  0xa1, 0xd2, 0x68,
]);

export function deriveRegistrationOrganizationId(
  rootContainerId: string,
): Promise<string> {
  return deriveStableUuidV4Shaped(ORGANIZATION_ID_NAMESPACE, rootContainerId);
}

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
    const root = containers.find(
      (container) => container.parentId === null && !container.systemSlot,
    );

    if (root) {
      return {
        containerId: root.id,
        created: false,
      };
    }

    const containerId = crypto.randomUUID();
    await saveContainer(lockedExecSql, {
      id: containerId,
      effectiveAccessLevel: "admin",
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

import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { ContainerStateMap } from "./containerStateMap";
import type { LocalContainerRefreshState } from "./localRefresh";

export function createRefreshState(input: {
  containersById?: Map<string, ContainerState>;
  loadContainers: ContainerContentsPersistence["loadContainers"];
  log?: (message: string) => void;
  reconcileLocalRootContainer?: ContainerContentsPersistence["reconcileLocalRootContainer"];
  reconcileLocalSystemContainer?: ContainerContentsPersistence["reconcileLocalSystemContainer"];
}): LocalContainerRefreshState {
  const saveContainer: ContainerContentsPersistence["saveContainer"] = async (
    _execSql,
    container,
  ) => container;

  return {
    containersById: new ContainerStateMap(input.containersById),
    documentStoresNeedPriming: false,
    initialized: true,
    lifecycleGeneration: 0,
    localContainerRefreshGeneration: null,
    localContainerRefreshPromise: null,
    localContainerRefreshStructuralGeneration: null,
    localContainersNeedRefresh: true,
    persistence: {
      enqueuePendingUpdate: async () => {},
      ensureSchema: async () => {},
      loadContainers: input.loadContainers,
      reconcileLocalRootContainer:
        input.reconcileLocalRootContainer ?? (async () => {}),
      reconcileLocalSystemContainer:
        input.reconcileLocalSystemContainer ?? (async () => {}),
      saveContainer,
    } as unknown as ContainerContentsPersistence,
    runtime: {
      auth: {
        organizationId: "organization-id",
        rootContainerId: "remote-root",
        userId: "user-1",
      },
      infra: {
        dbStatus: "ready",
        execSql: {} as ContainerContentsWorkflowRuntime["infra"]["execSql"],
      },
      util: {
        log: input.log ?? (() => {}),
      },
    } as ContainerContentsWorkflowRuntime,
    structuralGeneration: 0,
  };
}

export function createTreeContainerState(input: {
  id: string;
  parentId: string | null;
  remote: boolean;
  systemSlot?: ContainerSystemSlot | null | undefined;
}): ContainerState {
  const documentId = input.remote ? `${input.id}-metadata` : null;
  return {
    container: {
      icon: null,
      id: input.id,
      metadataDocumentId: documentId,
      name: input.parentId === null ? "/" : "Contacts",
      organizationId: input.remote ? "organization-id" : "",
      parentId: input.parentId,
      systemSlot: input.systemSlot ?? null,
    },
    doc: {} as ContainerState["doc"],
    record: {
      accessEpoch: 1,
      accessStateHash: input.remote ? `${input.id}-access-state` : null,
      contentKeyBundle: null,
      documentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: input.id,
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

import type {
  ContainerContentsStore,
  ContainerNode,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { useDeviceFirstContainerContents } from "../../stores/device-first/DeviceFirstProvider";
import {
  canProvisionExplorerSystemContainers,
  findExplorerSystemNode,
} from "../../stores/explorer/ExplorerSystemContainers";
import {
  findUserSystemContainer,
  type UserSystemContainer,
} from "../../stores/systemContainers";
import { useTearleads, useTearleadsRuntime } from "../sdk/TearleadsProvider";
import {
  resolveContactsBootstrapPolicy,
  usePrimaryLocalOrganization,
} from "../sdk/usePrimaryLocalOrganization";
import { useTearleadsExternalStoreSnapshot } from "../sdk/useTearleadsSubscription";
import {
  createSystemBootstrapTargetKey,
  runSystemBootstrap,
  type SystemBootstrapRunInput,
} from "./systemBootstrapRun";
import {
  usePromoteLocalSystemContainers,
  useProvisionedSystemContainerPull,
} from "./systemContainerSyncEffects";
import { useUserSystemContainers } from "./UserSystemContainersProvider";
import {
  type SystemBootstrapContextValue,
  useSystemBootstrapController,
} from "./useSystemBootstrapController";

const SystemBootstrapContext =
  createContext<SystemBootstrapContextValue | null>(null);

function useSystemBootstrapInput(input: {
  readonly bootstrapContacts: boolean | null;
  readonly enabled: boolean;
  readonly store: ContainerContentsStore;
  readonly storeReady: boolean;
  readonly storeNodes: ReadonlyArray<ContainerNode>;
  readonly systemContainers: ReadonlyArray<UserSystemContainer>;
  readonly tearleads: Tearleads;
}): SystemBootstrapRunInput | null {
  const appData = useTearleadsRuntime();
  const signingPrivateKey =
    appData.crypto.signingKeyPair?.signingPrivateKey ?? null;
  const contactsSystemContainer = findUserSystemContainer(
    input.systemContainers,
    "contacts",
  );
  const hasContactsSystemContainer = contactsSystemContainer !== null;
  const contactsContainer = contactsSystemContainer
    ? findExplorerSystemNode(
        input.storeNodes,
        contactsSystemContainer.systemSlot,
        appData.auth.organizationId,
        appData.state.containerId,
      )
    : null;
  const canProvisionSystemContainers = canProvisionExplorerSystemContainers({
    isAuthenticated: appData.auth.isAuthenticated,
    nodes: input.storeNodes,
    organizationId: appData.auth.organizationId,
    rootContainerId: appData.state.containerId,
  });

  return useMemo(() => {
    if (
      !input.enabled ||
      input.bootstrapContacts === null ||
      !signingPrivateKey ||
      appData.infra.dbStatus !== "ready" ||
      !appData.state.containerId ||
      !input.storeReady ||
      (input.bootstrapContacts && !hasContactsSystemContainer) ||
      input.systemContainers.length === 0 ||
      !canProvisionSystemContainers
    ) {
      return null;
    }

    return {
      appData,
      bootstrapContacts: input.bootstrapContacts,
      containerContentsStore: input.store,
      systemContainers: input.systemContainers,
      targetKey: createSystemBootstrapTargetKey({
        appData,
        bootstrapContacts: input.bootstrapContacts,
        contactsContainer,
        systemContainers: input.systemContainers,
      }),
      tearleads: input.tearleads,
    };
  }, [
    appData,
    canProvisionSystemContainers,
    contactsContainer,
    hasContactsSystemContainer,
    input.bootstrapContacts,
    input.enabled,
    input.store,
    input.storeReady,
    input.systemContainers,
    input.tearleads,
    signingPrivateKey,
  ]);
}

export function SystemBootstrapProvider({
  children,
  enabled = true,
}: PropsWithChildren<{ readonly enabled?: boolean | undefined }>) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const { containerStore: store } = useDeviceFirstContainerContents();
  const snapshot = useTearleadsExternalStoreSnapshot(store);
  const systemContainers = useUserSystemContainers();
  const primaryLocalOrganization = usePrimaryLocalOrganization({
    defaultOrganizationId: appData.auth.defaultOrganizationId,
    enabled:
      enabled &&
      appData.auth.isAuthenticated &&
      appData.infra.dbStatus === "ready",
  });
  const bootstrapContacts = resolveContactsBootstrapPolicy({
    currentOrganizationId: appData.auth.organizationId,
    isAuthenticated: appData.auth.isAuthenticated,
    primaryLocalOrganization,
  });
  const bootstrapInput = useSystemBootstrapInput({
    bootstrapContacts,
    enabled,
    store,
    storeNodes: snapshot.nodes,
    storeReady: snapshot.ready,
    systemContainers,
    tearleads,
  });
  const contextValue = useSystemBootstrapController({
    bootstrapInput,
    enabled,
    logError: tearleads.logError,
    runBootstrap: runSystemBootstrap,
  });

  usePromoteLocalSystemContainers({
    currentOrganizationId: appData.auth.organizationId,
    currentRootContainerId: appData.state.containerId,
    enabled,
    isAuthenticated: appData.auth.isAuthenticated,
    logError: tearleads.logError,
    snapshotNodes: snapshot.nodes,
    snapshotReady: snapshot.ready,
    store,
    systemContainers,
  });
  useProvisionedSystemContainerPull({
    currentOrganizationId: appData.auth.organizationId,
    currentRootContainerId: appData.state.containerId,
    enabled,
    isAuthenticated: appData.auth.isAuthenticated,
    logError: tearleads.logError,
    snapshotReady: snapshot.ready,
    store,
    systemContainers,
  });

  return (
    <SystemBootstrapContext.Provider value={contextValue}>
      {children}
    </SystemBootstrapContext.Provider>
  );
}

export function useSystemBootstrap(): SystemBootstrapContextValue {
  const context = useContext(SystemBootstrapContext);
  if (!context) {
    throw new Error(
      "useSystemBootstrap must be used within a SystemBootstrapProvider.",
    );
  }

  return context;
}

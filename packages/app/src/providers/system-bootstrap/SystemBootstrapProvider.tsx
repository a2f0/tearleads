import type {
  ContainerContentsStore,
  ContainerNode,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  canProvisionExplorerSystemContainers,
  findExplorerSystemNode,
} from "../../stores/explorer/ExplorerSystemContainers";
import {
  deriveUserSystemContainers,
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
  mergeSystemBootstrapState,
  runSystemBootstrap,
  type SystemBootstrapResult,
  type SystemBootstrapRunInput,
  type SystemBootstrapState,
  type SystemBootstrapStatus,
} from "./systemBootstrapRun";
import {
  usePromoteLocalSystemContainers,
  useProvisionedSystemContainerPull,
} from "./systemContainerSyncEffects";

interface SystemBootstrapContextValue {
  readonly ensureBootstrapped: () => Promise<SystemBootstrapResult>;
  readonly error: unknown;
  readonly isBootstrapping: boolean;
  readonly status: SystemBootstrapStatus;
}

const SYSTEM_BOOTSTRAP_LOG_LABEL = "System bootstrap";

const SystemBootstrapContext =
  createContext<SystemBootstrapContextValue | null>(null);

function useUserSystemContainers(input: {
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly signingPrivateKey: Uint8Array | null;
}): ReadonlyArray<UserSystemContainer> {
  const [systemContainers, setSystemContainers] = useState<
    ReadonlyArray<UserSystemContainer>
  >([]);

  useEffect(() => {
    if (!input.signingPrivateKey) {
      setSystemContainers([]);
      return;
    }

    let cancelled = false;
    void deriveUserSystemContainers(input.signingPrivateKey)
      .then((nextSystemContainers) => {
        if (!cancelled) {
          setSystemContainers(nextSystemContainers);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSystemContainers([]);
          input.logError("Failed to derive system bootstrap slots", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.logError, input.signingPrivateKey]);

  return systemContainers;
}

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

function useSystemBootstrapController(input: {
  readonly bootstrapInput: SystemBootstrapRunInput | null;
  readonly enabled: boolean;
  readonly logError: (message: string | Error, cause?: unknown) => void;
}): SystemBootstrapContextValue {
  const [state, setState] = useState<SystemBootstrapState>({
    error: null,
    hasCompleted: false,
    status: input.enabled ? "waiting" : "idle",
  });
  const completedTargetKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<SystemBootstrapResult> | null>(null);
  const latestInputRef = useRef<SystemBootstrapRunInput | null>(null);
  const applyState = useCallback(
    (next: Partial<SystemBootstrapState> & { status: SystemBootstrapStatus }) =>
      setState((previous) => mergeSystemBootstrapState(previous, next)),
    [],
  );

  useEffect(() => {
    latestInputRef.current = input.bootstrapInput;
  }, [input.bootstrapInput]);

  const ensureBootstrapped =
    useCallback(async (): Promise<SystemBootstrapResult> => {
      while (true) {
        const nextInput = latestInputRef.current;
        if (!nextInput) {
          return { completed: false, skipped: true };
        }
        if (completedTargetKeyRef.current === nextInput.targetKey) {
          return { completed: true };
        }
        if (inFlightRef.current) {
          await inFlightRef.current;
          continue;
        }

        applyState({ status: "running" });
        const bootstrapPromise = runSystemBootstrap(nextInput)
          .then((completed): SystemBootstrapResult => {
            // A newer input superseded this run while it was in flight (a
            // convergence re-key, or the controller was disabled). Let the
            // effect that changed it drive the next transition rather than
            // clobbering state — including the disabled "idle" reset — here.
            if (latestInputRef.current !== nextInput) {
              return { completed: false, skipped: true };
            }
            if (completed) {
              completedTargetKeyRef.current = nextInput.targetKey;
              applyState({ hasCompleted: true, status: "ready" });
              return { completed: true };
            }

            applyState({ status: "waiting" });
            return { completed: false };
          })
          .catch((error: unknown): SystemBootstrapResult => {
            if (latestInputRef.current !== nextInput) {
              return { completed: false, error };
            }
            input.logError("Failed to bootstrap system containers", error);
            applyState({ error, status: "error" });
            return { completed: false, error };
          })
          .finally(() => {
            if (inFlightRef.current === bootstrapPromise) {
              inFlightRef.current = null;
            }
          });

        inFlightRef.current = bootstrapPromise;
        return bootstrapPromise;
      }
    }, [applyState, input.logError]);

  useEffect(() => {
    if (!input.enabled) {
      completedTargetKeyRef.current = null;
      latestInputRef.current = null;
      applyState({ hasCompleted: false, status: "idle" });
      return;
    }
    if (!input.bootstrapInput) {
      if (!inFlightRef.current) {
        applyState({ status: "waiting" });
      }
      return;
    }
    if (completedTargetKeyRef.current === input.bootstrapInput.targetKey) {
      applyState({ hasCompleted: true, status: "ready" });
      return;
    }

    void ensureBootstrapped();
  }, [applyState, ensureBootstrapped, input.bootstrapInput, input.enabled]);

  return useMemo(
    () => ({
      ensureBootstrapped,
      error: state.error,
      // Only the first provisioning run gates the UI. Re-runs after a completed
      // bootstrap (e.g. a container converging local-only -> synced re-keys the
      // target) reconcile in the background without blanking an open mini-app.
      isBootstrapping: state.status === "running" && !state.hasCompleted,
      status: state.status,
    }),
    [ensureBootstrapped, state],
  );
}

export function SystemBootstrapProvider({
  children,
  enabled = true,
}: PropsWithChildren<{ readonly enabled?: boolean | undefined }>) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const runtime = useMemo(
    () => tearleads.containerContents.workflowRuntime(),
    [appData, tearleads],
  );
  const store = useMemo(
    () =>
      tearleads.containerContents.openTree({
        logLabel: SYSTEM_BOOTSTRAP_LOG_LABEL,
      }),
    [runtime.state.domainScope, tearleads],
  );
  const snapshot = useTearleadsExternalStoreSnapshot(store);
  const systemContainers = useUserSystemContainers({
    logError: tearleads.logError,
    signingPrivateKey: appData.crypto.signingKeyPair?.signingPrivateKey ?? null,
  });
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
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (runtime.infra.dbStatus === "ready" && !runtime.state.containerId) {
      return;
    }

    store.updateRuntime(runtime);
  }, [enabled, store, runtime]);

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

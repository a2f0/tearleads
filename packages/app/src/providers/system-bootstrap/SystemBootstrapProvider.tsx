import type {
  ContainerContentsStore,
  ContainerNode,
  Tearleads,
} from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
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
  type EnsureSelfContactInput,
  getSelfContactLocalId,
} from "../../stores/contacts/contactStore";
import {
  createContactsRuntimeForContainer,
  getOrCreateContactsStoreForRuntime,
} from "../../stores/contacts/useContactsStoreForContainer";
import {
  canProvisionExplorerSystemContainers,
  findExplorerSystemNode,
} from "../../stores/explorer/ExplorerSystemContainers";
import {
  deriveUserSystemContainers,
  findUserSystemContainer,
  type UserSystemContainer,
} from "../../stores/systemContainers";
import type { RuntimeSnapshot } from "../sdk/TearleadsProvider";
import { useTearleads, useTearleadsRuntime } from "../sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../sdk/useTearleadsSubscription";

type SystemBootstrapStatus = "idle" | "waiting" | "running" | "ready" | "error";

interface SystemBootstrapResult {
  readonly completed: boolean;
  readonly error?: unknown;
  readonly skipped?: boolean;
}

interface SystemBootstrapContextValue {
  readonly ensureBootstrapped: () => Promise<SystemBootstrapResult>;
  readonly error: unknown;
  readonly isBootstrapping: boolean;
  readonly status: SystemBootstrapStatus;
}

interface SystemBootstrapState {
  readonly error: unknown;
  readonly status: SystemBootstrapStatus;
}

interface SystemBootstrapRunInput {
  readonly appData: RuntimeSnapshot;
  readonly containerContentsStore: ContainerContentsStore;
  readonly systemContainers: ReadonlyArray<UserSystemContainer>;
  readonly targetKey: string;
  readonly tearleads: Tearleads;
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

function findExistingSystemContainer(
  store: ContainerContentsStore,
  systemContainer: UserSystemContainer,
): ContainerNode | null {
  return findExplorerSystemNode(
    store.getSnapshot().nodes,
    systemContainer.systemSlot,
  );
}

async function ensureSystemContainer(input: {
  readonly store: ContainerContentsStore;
  readonly systemContainer: UserSystemContainer;
}): Promise<ContainerNode | null> {
  const existing = findExistingSystemContainer(
    input.store,
    input.systemContainer,
  );
  if (existing) {
    return existing;
  }

  return input.store.ensureSystemContainer(
    input.systemContainer.systemSlot,
    input.systemContainer.name,
    {
      deferRemoteBootstrap: true,
      deferRemoteSync: true,
      skipAdvancedManagedRoot: true,
    },
  );
}

function getSelfContactInput(input: {
  readonly appData: RuntimeSnapshot;
  readonly includeRemoteIdentity: boolean;
}): EnsureSelfContactInput | null {
  const { appData, includeRemoteIdentity } = input;
  const signingFingerprint = appData.crypto.signingFingerprint;
  const localId = signingFingerprint
    ? getSelfContactLocalId(signingFingerprint)
    : null;
  const userId = includeRemoteIdentity ? appData.auth.userId : null;

  if (!localId && !userId) {
    return null;
  }

  return {
    deferRemoteSync: !includeRemoteIdentity,
    encapsulationPublicKey:
      includeRemoteIdentity && appData.crypto.encapsulationKeyPair
        ? bytesToBase64(appData.crypto.encapsulationKeyPair.publicKey)
        : null,
    localId,
    userId,
  };
}

async function ensureSelfContact(input: {
  readonly appData: RuntimeSnapshot;
  readonly contactsContainer: ContainerNode;
  readonly tearleads: Tearleads;
}): Promise<boolean> {
  const selfContact = getSelfContactInput({
    appData: input.appData,
    includeRemoteIdentity:
      input.contactsContainer.syncState.status !== "local-only",
  });
  if (!selfContact) {
    return false;
  }

  const documentsRuntime = input.tearleads.documents.workflowRuntime(
    input.contactsContainer.id,
  );
  const contactsRuntime = createContactsRuntimeForContainer(
    input.tearleads,
    documentsRuntime,
  );
  const contactsStore = getOrCreateContactsStoreForRuntime(
    input.tearleads,
    contactsRuntime,
  );
  contactsStore.updateRuntime(contactsRuntime);
  return (await contactsStore.ensureSelfContact(selfContact)) !== null;
}

async function runSystemBootstrap(
  input: SystemBootstrapRunInput,
): Promise<boolean> {
  let contactsContainer: ContainerNode | null = null;

  for (const systemContainer of input.systemContainers) {
    const ensuredContainer = await ensureSystemContainer({
      store: input.containerContentsStore,
      systemContainer,
    });
    if (systemContainer.kind === "contacts") {
      contactsContainer = ensuredContainer;
    }
  }

  if (!contactsContainer) {
    return false;
  }

  return ensureSelfContact({
    appData: input.appData,
    contactsContainer,
    tearleads: input.tearleads,
  });
}

function createSystemBootstrapTargetKey(input: {
  readonly appData: RuntimeSnapshot;
  readonly contactsContainer: ContainerNode | null;
  readonly systemContainers: ReadonlyArray<UserSystemContainer>;
}): string {
  return [
    input.appData.infra.dbId ?? "db",
    input.appData.crypto.signingFingerprint ?? "key",
    input.appData.state.containerId ?? "root",
    input.appData.auth.organizationId ?? "local-org",
    input.appData.auth.userId ?? "local-user",
    input.contactsContainer
      ? `${input.contactsContainer.id}:${input.contactsContainer.syncState.status}`
      : "missing-contacts",
    input.systemContainers
      .map((systemContainer) => systemContainer.systemSlot)
      .join(","),
  ].join(":");
}

function useSystemBootstrapInput(input: {
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
  const hasContactsSystemContainer = Boolean(
    findUserSystemContainer(input.systemContainers, "contacts"),
  );
  const contactsSystemContainer = findUserSystemContainer(
    input.systemContainers,
    "contacts",
  );
  const contactsContainer = contactsSystemContainer
    ? findExplorerSystemNode(
        input.storeNodes,
        contactsSystemContainer.systemSlot,
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
      !signingPrivateKey ||
      appData.infra.dbStatus !== "ready" ||
      !appData.state.containerId ||
      !input.storeReady ||
      !hasContactsSystemContainer ||
      input.systemContainers.length === 0 ||
      !canProvisionSystemContainers
    ) {
      return null;
    }

    return {
      appData,
      containerContentsStore: input.store,
      systemContainers: input.systemContainers,
      targetKey: createSystemBootstrapTargetKey({
        appData,
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
    status: input.enabled ? "waiting" : "idle",
  });
  const completedTargetKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<SystemBootstrapResult> | null>(null);
  const latestInputRef = useRef<SystemBootstrapRunInput | null>(null);

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

        setState({ error: null, status: "running" });
        const bootstrapPromise = runSystemBootstrap(nextInput)
          .then((completed): SystemBootstrapResult => {
            if (completed) {
              completedTargetKeyRef.current = nextInput.targetKey;
              setState({ error: null, status: "ready" });
              return { completed: true };
            }

            setState({ error: null, status: "waiting" });
            return { completed: false };
          })
          .catch((error: unknown): SystemBootstrapResult => {
            input.logError("Failed to bootstrap system containers", error);
            setState({ error, status: "error" });
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
    }, [input.logError]);

  useEffect(() => {
    if (!input.enabled) {
      completedTargetKeyRef.current = null;
      latestInputRef.current = null;
      setState({ error: null, status: "idle" });
      return;
    }
    if (!input.bootstrapInput) {
      if (!inFlightRef.current) {
        setState({ error: null, status: "waiting" });
      }
      return;
    }
    if (completedTargetKeyRef.current === input.bootstrapInput.targetKey) {
      setState({ error: null, status: "ready" });
      return;
    }

    void ensureBootstrapped();
  }, [ensureBootstrapped, input.bootstrapInput, input.enabled]);

  return useMemo(
    () => ({
      ensureBootstrapped,
      error: state.error,
      isBootstrapping: state.status === "running",
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
  const bootstrapInput = useSystemBootstrapInput({
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
    if (runtime.infra.dbStatus === "ready" && !runtime.state.containerId) {
      return;
    }

    store.updateRuntime(runtime);
  }, [store, runtime]);

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

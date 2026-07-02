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
              // The structural sync lane (create/promote intents) advancing a
              // container to synced does not by itself re-hydrate the in-memory
              // tree from the server, so an already-open Explorer keeps
              // rendering the pre-sync local-only badges until it is remounted.
              // Re-run the same root-lane hydration the reopen path uses, once
              // per bootstrap, so the synced badges surface without a reopen.
              // The store is shared per scope, so this re-emits to the live
              // Explorer; it is gated on a ready+online runtime internally and
              // no-ops (no extra render) when nothing changed.
              void nextInput.containerContentsStore
                .refreshRootLane()
                .catch(() => undefined);
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
    if (!enabled) {
      return;
    }
    if (runtime.infra.dbStatus === "ready" && !runtime.state.containerId) {
      return;
    }

    store.updateRuntime(runtime);
  }, [enabled, store, runtime]);

  // Promote device-first (local-only) system containers into remote sync once
  // the runtime is authenticated.
  //
  // Why this exists separately from the main bootstrap run: the provisioning
  // controller creates each system slot local-only pre-auth and is deliberately
  // keyed so it does NOT re-run on the bare auth transition (createSystemBootstrapTargetKey
  // omits isAuthenticated to avoid re-seeding churn — folding auth into the key
  // instead sends the controller into a setState loop). That leaves a gap: a
  // system container created before login would otherwise stay local-only forever
  // and never reach the server, so a peer granted the root never sees the owner's
  // Contacts/Trash. This pass fills the gap. Promoting contacts to remote flips
  // the contacts axis of the bootstrap target key, which re-runs the main pass to
  // upgrade the self contact with its remote identity.
  //
  // Loop-safety: it only acts on slots still reporting local-only (so it stops
  // once a slot converges and retries if a promotion no-ops during the auth
  // handoff), guards against duplicate in-flight calls per slot, and never calls
  // setState — a no-op ensureSystemContainer does not mutate the snapshot. It does
  // NOT pass skipAdvancedManagedRoot: the create-intent replay keys the child for
  // the managed principal exactly like a normal child create, so promotion under
  // an org-managed (admins-group) root is correct, not skippable.
  const promotingSystemSlotsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!enabled || !appData.auth.isAuthenticated || !snapshot.ready) {
      return;
    }
    for (const systemContainer of systemContainers) {
      const slot = systemContainer.systemSlot;
      const node = findExplorerSystemNode(snapshot.nodes, slot);
      if (
        !node ||
        node.syncState.status !== "local-only" ||
        promotingSystemSlotsRef.current.has(slot)
      ) {
        continue;
      }

      promotingSystemSlotsRef.current.add(slot);
      void store
        .ensureSystemContainer(slot, systemContainer.name, {})
        .catch((error: unknown) => {
          tearleads.logError(
            "Failed to promote system container to remote sync",
            error,
          );
        })
        .finally(() => {
          promotingSystemSlotsRef.current.delete(slot);
        });
    }
    // Narrow to the two snapshot fields this effect actually reads (ready guard +
    // nodes lookup) rather than the whole snapshot object, so it does not re-run on
    // every unrelated store update.
  }, [
    enabled,
    appData.auth.isAuthenticated,
    snapshot.ready,
    snapshot.nodes,
    systemContainers,
    store,
    tearleads.logError,
  ]);

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

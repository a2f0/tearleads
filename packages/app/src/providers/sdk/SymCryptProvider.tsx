import {
  type BlobStoreFactory,
  createBrowserNetworkStatusSource,
  createEncryptedBlobStore,
  createLazyEncryptedBlobStore,
  type LocalKeyPurpose,
  type LocalKeyring,
  SymCrypt,
} from "@symcrypt/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import type { CreateNetworkStatusFn } from "../../host/AppHostConfig";
import { PROVISIONED_SYSTEM_CONTAINER_SPECS } from "../../stores/systemContainers";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLocalKeyringLock } from "../local-keyring/LocalKeyringLockProvider";
import { LOCAL_BLOB_STORE_SCOPE_NAMESPACE } from "../local-keyring/localKeyringScopes";
import { useLog } from "../logging/LogProvider";
import { useSyncMode } from "../sync-mode/SyncModeProvider";
import { useServerEventsBinding } from "./serverEventsBinding";
import { useSymCryptExternalValue } from "./useSymCryptSubscription";

const SdkContext = createContext<SymCrypt | null>(null);
const DEVELOPMENT_LOCAL_STORAGE_KEY = "development-key";
const DEVELOPMENT_HOSTNAMES = new Set([
  "",
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "localhost",
]);

type SymCryptRuntimeInput = ReturnType<SymCrypt["runtime"]["input"]>;

export type RuntimeSnapshot = Omit<SymCryptRuntimeInput, "auth" | "infra"> & {
  readonly auth: SymCryptRuntimeInput["auth"] & {
    readonly authToken: string | null;
  };
  readonly infra: SymCryptRuntimeInput["infra"] & {
    readonly dbId: string | null;
  };
};

const RuntimeContext = createContext<RuntimeSnapshot | null>(null);

function allowDevelopmentBlobStoreFallback(): boolean {
  if (typeof location !== "object") {
    return false;
  }

  return DEVELOPMENT_HOSTNAMES.has(location.hostname);
}

function createDevelopmentBlobStoreFactory(): BlobStoreFactory {
  if (!allowDevelopmentBlobStoreFallback()) {
    throw new Error(
      "AppHostConfig.createBlobStore is required outside local development.",
    );
  }

  return (namespace) =>
    createEncryptedBlobStore(namespace, {
      key: DEVELOPMENT_LOCAL_STORAGE_KEY,
    });
}

function localBlobStoreKeyPurpose(namespace: string): LocalKeyPurpose {
  return `blob-store:${namespace}`;
}

function createLocalKeyringBlobStoreFactory(input: {
  readonly createLocalKeyring: () => LocalKeyring;
}): BlobStoreFactory {
  let keyring: LocalKeyring | null = null;
  let keyDerivationQueue: Promise<void> = Promise.resolve();

  function deriveBlobStoreKey(namespace: string) {
    const operation = keyDerivationQueue.then(async () => {
      keyring ??= input.createLocalKeyring();
      const session = await keyring.getOrCreateSession({
        namespace: LOCAL_BLOB_STORE_SCOPE_NAMESPACE,
      });
      try {
        return await session.deriveKey(localBlobStoreKeyPurpose(namespace));
      } finally {
        session.dispose();
      }
    });

    keyDerivationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  return (namespace) =>
    createLazyEncryptedBlobStore(namespace, () =>
      deriveBlobStoreKey(namespace),
    );
}

// Binds the SDK's connectivity state to the host's network source. The source
// is the browser default (navigator.onLine + window online/offline events)
// unless the shell injects one — Capacitor does, backed by @capacitor/network,
// because the Android WebView's navigator.onLine reports offline while the
// device is genuinely connected.
function useNetworkStatusBinding(
  symcrypt: SymCrypt,
  createNetworkStatus: CreateNetworkStatusFn | undefined,
  log: (message: string) => void,
): void {
  useEffect(() => {
    let cancelled = false;
    const source =
      createNetworkStatus?.() ?? createBrowserNetworkStatusSource();

    // Record how the source reads connectivity, so a support log shows whether
    // (e.g.) the native connectivity plugin is active or the shell fell back to
    // navigator.onLine — the difference between a real offline and a false one.
    // Guarded so a resolve after unmount (or a StrictMode remount) does not log.
    source
      .diagnose?.()
      .then((snapshot) => {
        if (!cancelled) {
          log(`Network source: ${snapshot}`);
        }
      })
      .catch(() => {});

    // Tell the SDK whether this source is the authoritative connectivity truth.
    // A native OS-backed source (Capacitor) is: once bound, a failed backend
    // request must not flip connectivity offline, because the OS — not a request
    // outcome — knows whether the device is connected. The browser source omits
    // the flag, keeping the fetch-failure-drives-offline behavior it relies on.
    symcrypt.network.setConnectivityAuthoritative(
      source.authoritative ?? false,
    );

    // Seed from the source before subscribing, replacing the SDK constructor's
    // navigator.onLine read (wrong on Capacitor Android). An async native
    // source seeds optimistically here and corrects via the first emission.
    symcrypt.network.setOnline(source.getOnline());

    const unsubscribe = source.subscribe((online) => {
      symcrypt.network.setOnline(online);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      source.dispose?.();
    };
  }, [createNetworkStatus, log, symcrypt]);
}

// `symcrypt` is created once per provider via useState and never changes, so
// the only thing that re-runs this effect is a remount of the same instance —
// the effect dependency cannot carry a different instance, so there is no
// instance-swap path to dispose here.
function useSymCryptDisposeOnUnmount(symcrypt: SymCrypt): void {
  const disposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A remount (including StrictMode's dev double-invoke) re-runs this setup
    // and cancels a dispose queued by the previous cleanup: the tree is alive,
    // so the SDK and its sync coordinator must keep running.
    if (disposeTimerRef.current !== null) {
      clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }

    return () => {
      // Defer to a macrotask. StrictMode unmounts then immediately remounts in
      // the same tick, which cancels this; a real unmount has no remount, so the
      // deferred dispose fires and the coordinator pump cannot outlive the tree.
      disposeTimerRef.current = setTimeout(() => {
        disposeTimerRef.current = null;
        symcrypt.dispose();
      }, 0);
    };
  }, [symcrypt]);
}

function useNetworkTransitionLog(symcrypt: SymCrypt): void {
  const { log } = useLog();

  useEffect(
    () =>
      symcrypt.network.subscribe((online) => {
        log(online ? "Network online" : "Network offline");
      }),
    [log, symcrypt],
  );
}

export function SymCryptProvider({ children }: PropsWithChildren) {
  const hostConfig = useAppHostConfig();
  const localKeyringLock = useLocalKeyringLock();
  const { log, logError } = useLog();
  const { syncEnabled } = useSyncMode();
  const blobStoreFactory = useMemo((): BlobStoreFactory => {
    if (hostConfig.createBlobStore) {
      return hostConfig.createBlobStore;
    }

    if (localKeyringLock.createLocalKeyring) {
      return createLocalKeyringBlobStoreFactory({
        createLocalKeyring: localKeyringLock.createLocalKeyring,
      });
    }

    return createDevelopmentBlobStoreFactory();
  }, [hostConfig.createBlobStore, localKeyringLock.createLocalKeyring]);
  const [symcrypt] = useState(() => {
    const instance = new SymCrypt({
      apiBaseUrl: hostConfig.apiBaseUrl,
      blobStoreFactory,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      logger: { log, logError },
      // Per-pane namespace so each pane derives a distinct Loro peer id; two
      // panes editing the same document must not share a peer (it corrupts
      // the CRDT). Undefined for single-pane keeps the bare device peer.
      peerScope: hostConfig.localIdentityNamespace,
      // Every new organization is born with the Explorer Trash bin in the same
      // provisioning transaction as the org itself.
      provisionedSystemContainers: PROVISIONED_SYSTEM_CONTAINER_SPECS,
    });
    // Apply the persisted preference before the first runtime.input() (read
    // below), so the initial render and every child provider mount consistent
    // with it — a persisted "local-only" preference never triggers a first-
    // render sync attempt or an extra render pass. Runtime toggles go through
    // the effect below.
    instance.session.setSyncEnabled(syncEnabled);
    return instance;
  });
  const runtimeVersion = useSymCryptExternalValue(
    symcrypt.runtime.subscribe,
    () => symcrypt.runtime.version,
  );
  const runtimeInput = useMemo(
    () => symcrypt.runtime.input(),
    [runtimeVersion, symcrypt],
  );
  const runtimeAuth = useMemo(
    () => ({
      ...runtimeInput.auth,
      authToken: symcrypt.session.authToken,
    }),
    [runtimeInput.auth, symcrypt.session.authToken],
  );
  const runtimeInfra = useMemo(
    () => ({
      ...runtimeInput.infra,
      dbId: symcrypt.database.id,
    }),
    [runtimeInput.infra, symcrypt.database.id],
  );
  const runtimeSnapshot = useMemo<RuntimeSnapshot>(
    () => ({
      ...runtimeInput,
      auth: runtimeAuth,
      infra: runtimeInfra,
    }),
    [runtimeInput, runtimeAuth, runtimeInfra],
  );

  // Keep the SDK in sync with runtime preference toggles (the initial value is
  // applied at construction above). Folded into the resolved runtime
  // `state.online`, so the reconciler and upload paths pause in local-only mode;
  // the events WebSocket is gated separately just below.
  useEffect(() => {
    symcrypt.session.setSyncEnabled(syncEnabled);
  }, [syncEnabled, symcrypt]);

  useNetworkStatusBinding(symcrypt, hostConfig.createNetworkStatus, log);
  useNetworkTransitionLog(symcrypt);
  useSymCryptDisposeOnUnmount(symcrypt);
  useServerEventsBinding(
    symcrypt,
    hostConfig.wsUrl,
    runtimeAuth.authToken,
    log,
    syncEnabled,
    runtimeInput.state.online,
    hostConfig.subscribeConnectionRefresh,
  );

  return (
    <SdkContext.Provider value={symcrypt}>
      <RuntimeContext.Provider value={runtimeSnapshot}>
        {children}
      </RuntimeContext.Provider>
    </SdkContext.Provider>
  );
}

export function useSymCrypt(): SymCrypt {
  const context = useContext(SdkContext);
  if (!context) {
    throw new Error("useSymCrypt must be used within a SymCryptProvider.");
  }

  return context;
}

export function useSymCryptRuntime(): RuntimeSnapshot {
  const context = useContext(RuntimeContext);
  if (!context) {
    throw new Error(
      "useSymCryptRuntime must be used within a SymCryptProvider.",
    );
  }

  return context;
}

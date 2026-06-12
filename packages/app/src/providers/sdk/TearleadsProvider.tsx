import {
  type BlobStoreFactory,
  createEncryptedBlobStore,
  createLazyEncryptedBlobStore,
  type LocalKeyPurpose,
  type LocalKeyring,
  Tearleads,
} from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { hasStringProperty } from "@tearleads/validators/util";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLocalKeyringLock } from "../local-keyring/LocalKeyringLockProvider";
import { LOCAL_BLOB_STORE_SCOPE_NAMESPACE } from "../local-keyring/localKeyringScopes";
import { useLog } from "../logging/LogProvider";
import { useTearleadsExternalValue } from "./useTearleadsSubscription";

const SdkContext = createContext<Tearleads | null>(null);
const DEVELOPMENT_LOCAL_STORAGE_KEY = "development-key";
const DEVELOPMENT_HOSTNAMES = new Set([
  "",
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "localhost",
]);

type TearleadsRuntimeInput = ReturnType<Tearleads["runtime"]["input"]>;

export type RuntimeSnapshot = Omit<TearleadsRuntimeInput, "auth" | "infra"> & {
  readonly auth: TearleadsRuntimeInput["auth"] & {
    readonly authToken: string | null;
  };
  readonly infra: TearleadsRuntimeInput["infra"] & {
    readonly dbId: string | null;
  };
};

const RuntimeContext = createContext<RuntimeSnapshot | null>(null);

function isServerEvent(value: unknown): value is {
  type: string;
  [key: string]: unknown;
} {
  return isPlainObject(value) && hasStringProperty(value, "type");
}

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

let nextEventId = 0;

function useBrowserNetworkBinding(tearleads: Tearleads): void {
  useEffect(() => {
    const goOnline = () => tearleads.network.setOnline(true);
    const goOffline = () => tearleads.network.setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [tearleads]);
}

function useNetworkTransitionLog(tearleads: Tearleads): void {
  const { log } = useLog();

  useEffect(
    () =>
      tearleads.network.subscribe((online) => {
        log(online ? "Network online" : "Network offline");
      }),
    [log, tearleads],
  );
}

function useServerEventsBinding(
  tearleads: Tearleads,
  wsUrl: string,
  log: (message: string) => void,
): void {
  useEffect(() => {
    let cancelled = false;
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      if (cancelled) {
        return;
      }

      tearleads.events.setConnected(true);
      log("WebSocket connected");
    });

    ws.addEventListener("message", (event) => {
      if (cancelled) {
        return;
      }

      try {
        const data: unknown = JSON.parse(String(event.data));
        if (isServerEvent(data)) {
          tearleads.events.push({ ...data, id: String(nextEventId++) });
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener("close", () => {
      if (!cancelled) {
        tearleads.events.setConnected(false);
      }
    });

    ws.addEventListener("error", () => {
      if (!cancelled) {
        tearleads.events.setConnected(false);
      }
    });

    return () => {
      cancelled = true;
      ws.close();
      tearleads.events.setConnected(false);
    };
  }, [log, tearleads, wsUrl]);
}

export function TearleadsProvider({ children }: PropsWithChildren) {
  const hostConfig = useAppHostConfig();
  const localKeyringLock = useLocalKeyringLock();
  const { log, logError } = useLog();
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
  const [tearleads] = useState(
    () =>
      new Tearleads({
        apiBaseUrl: hostConfig.apiBaseUrl,
        blobStoreFactory,
        documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
        logger: { log, logError },
      }),
  );
  const runtimeVersion = useTearleadsExternalValue(
    tearleads.runtime.subscribe,
    () => tearleads.runtime.version,
  );
  const runtimeInput = useMemo(
    () => tearleads.runtime.input(),
    [runtimeVersion, tearleads],
  );
  const runtimeAuth = useMemo(
    () => ({
      ...runtimeInput.auth,
      authToken: tearleads.session.authToken,
    }),
    [runtimeInput.auth, tearleads.session.authToken],
  );
  const runtimeInfra = useMemo(
    () => ({
      ...runtimeInput.infra,
      dbId: tearleads.database.id,
    }),
    [runtimeInput.infra, tearleads.database.id],
  );
  const runtimeSnapshot = useMemo<RuntimeSnapshot>(
    () => ({
      ...runtimeInput,
      auth: runtimeAuth,
      infra: runtimeInfra,
    }),
    [runtimeInput, runtimeAuth, runtimeInfra],
  );

  useBrowserNetworkBinding(tearleads);
  useNetworkTransitionLog(tearleads);
  useServerEventsBinding(tearleads, hostConfig.wsUrl, log);

  return (
    <SdkContext.Provider value={tearleads}>
      <RuntimeContext.Provider value={runtimeSnapshot}>
        {children}
      </RuntimeContext.Provider>
    </SdkContext.Provider>
  );
}

export function useTearleads(): Tearleads {
  const context = useContext(SdkContext);
  if (!context) {
    throw new Error("useTearleads must be used within a TearleadsProvider.");
  }

  return context;
}

export function useTearleadsRuntime(): RuntimeSnapshot {
  const context = useContext(RuntimeContext);
  if (!context) {
    throw new Error(
      "useTearleadsRuntime must be used within a TearleadsProvider.",
    );
  }

  return context;
}

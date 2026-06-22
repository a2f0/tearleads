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

// The server's reconnect baseline frame: the container ids it already holds for
// this session. Returns the (possibly empty) set, or null when not that frame.
function readInterestStateContainerIds(value: unknown): string[] | null {
  if (!isServerEvent(value) || value.type !== "interest_state") {
    return null;
  }
  const containerIds = Reflect.get(value, "containerIds");
  if (!Array.isArray(containerIds)) {
    return [];
  }
  return containerIds.filter((id): id is string => typeof id === "string");
}

function routeIncomingWsMessage(
  rawData: string,
  handlers: {
    onInterestState: (baseline: string[]) => void;
    onServerEvent: (event: { type: string; [key: string]: unknown }) => void;
  },
): void {
  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    return;
  }

  const baseline = readInterestStateContainerIds(data);
  if (baseline !== null) {
    handlers.onInterestState(baseline);
    return;
  }
  if (isServerEvent(data)) {
    handlers.onServerEvent(data);
  }
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

function appendTicketToWsUrl(wsUrl: string, ticket: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

// Single pass over each set so only the changed ids are allocated, not a full
// array copy of a possibly-thousands-strong known set on every change.
function diffContainerInterest(
  current: ReadonlySet<string>,
  declared: ReadonlySet<string>,
): { added: string[]; removed: string[] } {
  const added: string[] = [];
  for (const id of current) {
    if (!declared.has(id)) {
      added.push(id);
    }
  }
  const removed: string[] = [];
  for (const id of declared) {
    if (!current.has(id)) {
      removed.push(id);
    }
  }
  return { added, removed };
}

/**
 * Declare the containers this client cares about so the server only routes their
 * invalidations here. Seeds from the (passively shared) container tree and pushes
 * add/remove deltas as it changes, rather than re-sending the whole set — a
 * device may know thousands of containers. Interest is not authorization; the
 * server still enforces access, and missed events are recovered over HTTP sync.
 * Returns a cleanup that stops the subscription.
 */
export function startContainerInterestDeclaration(
  tearleads: Tearleads,
  ws: WebSocket,
  baseline: ReadonlySet<string>,
): () => void {
  let store: ReturnType<Tearleads["containerContents"]["openTree"]>;
  try {
    store = tearleads.containerContents.openTree();
  } catch {
    // Runtime not ready yet; the next reconnect re-declares from a ready tree.
    return () => undefined;
  }

  // The server already holds `baseline` (hydrated from its per-session interest
  // set), so only the delta between it and the current tree needs declaring —
  // a reconnect never resends the whole known set.
  let declared = new Set(baseline);

  const send = (message: Record<string, unknown>): void => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(message));
  };

  const syncInterest = (): void => {
    const current = new Set(store.getSnapshot().nodes.map((node) => node.id));
    const { added, removed } = diffContainerInterest(current, declared);
    if (added.length > 0) {
      send({ type: "known_containers.add", containerIds: added });
    }
    if (removed.length > 0) {
      send({ type: "known_containers.remove", containerIds: removed });
    }
    declared = current;
  };

  syncInterest();
  return store.subscribe(syncInterest);
}

function useServerEventsBinding(
  tearleads: Tearleads,
  wsUrl: string,
  authToken: string | null,
  log: (message: string) => void,
): void {
  useEffect(() => {
    // The websocket handshake authenticates with a single-use ticket minted by
    // the active session, so there is nothing to connect to until logged in.
    // An empty wsUrl (unconfigured host) would also throw when building the
    // ticketed URL, so skip in that case too.
    if (!authToken || !wsUrl) {
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let stopInterest: (() => void) | null = null;

    void (async () => {
      const ticket = await tearleads.requestWebSocketTicket();
      if (cancelled || ticket === null) {
        return;
      }

      const ws = new WebSocket(appendTicketToWsUrl(wsUrl, ticket));
      socket = ws;

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

        routeIncomingWsMessage(String(event.data), {
          // The server sends interest_state once on (re)connect with the
          // baseline it already holds; declare interest as a delta against it.
          onInterestState: (baseline) => {
            stopInterest?.();
            stopInterest = startContainerInterestDeclaration(
              tearleads,
              ws,
              new Set(baseline),
            );
          },
          onServerEvent: (data) => {
            tearleads.events.push({ ...data, id: String(nextEventId++) });
          },
        });
      });

      ws.addEventListener("close", () => {
        stopInterest?.();
        stopInterest = null;
        if (!cancelled) {
          tearleads.events.setConnected(false);
        }
      });

      ws.addEventListener("error", () => {
        stopInterest?.();
        stopInterest = null;
        if (!cancelled) {
          tearleads.events.setConnected(false);
        }
      });
    })();

    return () => {
      cancelled = true;
      stopInterest?.();
      socket?.close();
      tearleads.events.setConnected(false);
    };
  }, [authToken, log, tearleads, wsUrl]);
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
  useServerEventsBinding(
    tearleads,
    hostConfig.wsUrl,
    runtimeAuth.authToken,
    log,
  );

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

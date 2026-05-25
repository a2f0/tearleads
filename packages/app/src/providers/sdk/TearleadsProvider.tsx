import { Tearleads } from "@tearleads/client-sdk";
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
import { useLog } from "../logging/LogProvider";
import { useTearleadsExternalValue } from "./useTearleadsSubscription";

const SdkContext = createContext<Tearleads | null>(null);

export type RuntimeSnapshot = ReturnType<Tearleads["runtime"]["input"]> & {
  authToken: string | null;
  dbId: string | null;
};

const RuntimeContext = createContext<RuntimeSnapshot | null>(null);

function isServerEvent(value: unknown): value is {
  type: string;
  [key: string]: unknown;
} {
  return isPlainObject(value) && hasStringProperty(value, "type");
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
  const { log, logError } = useLog();
  const [tearleads] = useState(
    () =>
      new Tearleads({
        apiBaseUrl: hostConfig.apiBaseUrl,
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
  const runtimeSnapshot = useMemo<RuntimeSnapshot>(
    () => ({
      ...runtimeInput,
      authToken: tearleads.session.authToken,
      dbId: tearleads.database.id,
    }),
    [
      runtimeInput,
      tearleads.session.authToken,
      tearleads.database.id,
      tearleads,
    ],
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

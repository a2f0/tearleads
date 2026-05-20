import { Tearleads } from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { hasStringProperty } from "@tearleads/validators/util";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import { APP_DOCUMENT_PROJECTOR_REGISTRY } from "../../document-types/projectors";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLog } from "../logging/LogProvider";

const TearleadsContext = createContext<Tearleads | null>(null);

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
        documentProjectors: APP_DOCUMENT_PROJECTOR_REGISTRY,
        logger: { log, logError },
      }),
  );
  useBrowserNetworkBinding(tearleads);
  useNetworkTransitionLog(tearleads);
  useServerEventsBinding(tearleads, hostConfig.wsUrl, log);

  return (
    <TearleadsContext.Provider value={tearleads}>
      {children}
    </TearleadsContext.Provider>
  );
}

export function useTearleads(): Tearleads {
  const context = useContext(TearleadsContext);
  if (!context) {
    throw new Error("useTearleads must be used within a TearleadsProvider.");
  }

  return context;
}

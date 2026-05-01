import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { hasStringProperty } from "@tearleads/validators/util";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLog } from "../logging/LogProvider";

function isServerEvent(value: unknown): value is ServerEvent {
  return isPlainObject(value) && hasStringProperty(value, "type");
}

interface ServerEvent {
  id: string;
  type: string;
  [key: string]: unknown;
}

let nextEventId = 0;

interface EventsContextValue {
  events: ReadonlyArray<ServerEvent>;
  connected: boolean;
}

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: PropsWithChildren) {
  const hostConfig = useAppHostConfig();
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const { log } = useLog();

  useEffect(() => {
    let cancelled = false;
    const ws = new WebSocket(hostConfig.wsUrl);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      if (cancelled) return;
      setConnected(true);
      log("WebSocket connected");
    });

    ws.addEventListener("message", (event) => {
      if (cancelled) return;
      try {
        const data: unknown = JSON.parse(String(event.data));
        if (isServerEvent(data)) {
          setEvents((prev) => [
            ...prev,
            { ...data, id: String(nextEventId++) },
          ]);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener("close", () => {
      if (cancelled) return;
      setConnected(false);
    });

    ws.addEventListener("error", () => {
      if (cancelled) return;
      setConnected(false);
    });

    return () => {
      cancelled = true;
      ws.close();
      wsRef.current = null;
    };
  }, [hostConfig.wsUrl, log]);

  const value = useMemo(() => ({ events, connected }), [events, connected]);

  return (
    <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
  );
}

export function useEvents(): EventsContextValue {
  const ctx = useContext(EventsContext);
  if (!ctx) {
    throw new Error("useEvents must be used within an EventsProvider.");
  }
  return ctx;
}

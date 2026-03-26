import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLog } from "../logging/LogProvider";

const WS_URL = "ws://localhost:3001";

function isServerEvent(value: unknown): value is ServerEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as ServerEvent).type === "string"
  );
}

export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

interface EventsContextValue {
  events: ReadonlyArray<ServerEvent>;
  connected: boolean;
}

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: PropsWithChildren) {
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const { log } = useLog();

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnected(true);
      log("WebSocket connected");
    });

    ws.addEventListener("message", (event) => {
      try {
        const data: unknown = JSON.parse(String(event.data));
        if (isServerEvent(data)) {
          setEvents((prev) => [...prev, data]);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener("close", () => {
      setConnected(false);
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

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

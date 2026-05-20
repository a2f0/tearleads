import { useMemo, useSyncExternalStore } from "react";
import { useTearleads } from "../sdk/TearleadsProvider";

interface ServerEvent {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface EventsContextValue {
  connected: boolean;
  events: ReadonlyArray<ServerEvent>;
}

export function useEvents(): EventsContextValue {
  const tearleads = useTearleads();
  const snapshot = useSyncExternalStore(
    tearleads.events.subscribe,
    () => tearleads.events.snapshot,
    () => tearleads.events.snapshot,
  );

  return useMemo(
    () => ({
      connected: snapshot.connected,
      events: snapshot.events as ReadonlyArray<ServerEvent>,
    }),
    [snapshot],
  );
}

import { useMemo } from "react";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";

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
  const snapshot = useTearleadsStoreSnapshot(tearleads.events);

  return useMemo(
    () => ({
      connected: snapshot.connected,
      events: snapshot.events as ReadonlyArray<ServerEvent>,
    }),
    [snapshot],
  );
}

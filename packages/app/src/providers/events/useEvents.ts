import { useMemo } from "react";
import { useSymCrypt } from "../sdk/SymCryptProvider";
import { useSymCryptStoreSnapshot } from "../sdk/useSymCryptSubscription";

interface ServerEvent {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface EventsContextValue {
  connected: boolean;
  events: ReadonlyArray<ServerEvent>;
}

function isServerEvent(value: unknown): value is ServerEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const id = Reflect.get(value, "id");
  const type = Reflect.get(value, "type");
  return typeof id === "string" && typeof type === "string";
}

export function useEvents(): EventsContextValue {
  const symcrypt = useSymCrypt();
  const snapshot = useSymCryptStoreSnapshot(symcrypt.events);

  return useMemo(
    () => ({
      connected: snapshot.connected,
      events: snapshot.events.filter(isServerEvent),
    }),
    [snapshot],
  );
}

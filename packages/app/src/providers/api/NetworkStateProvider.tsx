import { useMemo, useSyncExternalStore } from "react";
import { useTearleads } from "../sdk/TearleadsProvider";

interface NetworkStateContextValue {
  online: boolean;
}

export function useNetworkState(): NetworkStateContextValue {
  const tearleads = useTearleads();
  const online = useSyncExternalStore(
    tearleads.network.subscribe,
    () => tearleads.network.online,
    () => tearleads.network.online,
  );

  return useMemo(() => ({ online }), [online]);
}

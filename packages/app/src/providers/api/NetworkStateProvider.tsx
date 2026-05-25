import { useMemo } from "react";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsExternalValue } from "../sdk/useTearleadsSubscription";

interface NetworkStateContextValue {
  online: boolean;
}

export function useNetworkState(): NetworkStateContextValue {
  const tearleads = useTearleads();
  const online = useTearleadsExternalValue(
    (listener) => tearleads.network.subscribe(listener),
    () => tearleads.network.online,
  );

  return useMemo(() => ({ online }), [online]);
}

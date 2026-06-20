import type { NetworkMode } from "@tearleads/client-sdk";
import { useCallback, useMemo } from "react";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsExternalValue } from "../sdk/useTearleadsSubscription";

interface NetworkStateContextValue {
  mode: NetworkMode;
  online: boolean;
  setNetworkMode: (mode: NetworkMode) => void;
}

export function useNetworkState(): NetworkStateContextValue {
  const tearleads = useTearleads();
  const mode = useTearleadsExternalValue(
    tearleads.network.subscribe,
    () => tearleads.network.mode,
  );
  const online = useTearleadsExternalValue(
    tearleads.network.subscribe,
    () => tearleads.network.online,
  );
  const setNetworkMode = useCallback(
    (nextMode: NetworkMode) => tearleads.network.setMode(nextMode),
    [tearleads],
  );

  return useMemo(
    () => ({ mode, online, setNetworkMode }),
    [mode, online, setNetworkMode],
  );
}

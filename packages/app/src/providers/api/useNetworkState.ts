import type { NetworkMode } from "@symcrypt/client-sdk";
import { useCallback, useMemo } from "react";
import { useSymCrypt } from "../sdk/SymCryptProvider";
import { useSymCryptExternalValue } from "../sdk/useSymCryptSubscription";

interface NetworkStateContextValue {
  mode: NetworkMode;
  online: boolean;
  setNetworkMode: (mode: NetworkMode) => void;
}

export function useNetworkState(): NetworkStateContextValue {
  const symcrypt = useSymCrypt();
  const mode = useSymCryptExternalValue(
    symcrypt.network.subscribe,
    () => symcrypt.network.mode,
  );
  const online = useSymCryptExternalValue(
    symcrypt.network.subscribe,
    () => symcrypt.network.online,
  );
  const setNetworkMode = useCallback(
    (nextMode: NetworkMode) => symcrypt.network.setMode(nextMode),
    [symcrypt],
  );

  return useMemo(
    () => ({ mode, online, setNetworkMode }),
    [mode, online, setNetworkMode],
  );
}

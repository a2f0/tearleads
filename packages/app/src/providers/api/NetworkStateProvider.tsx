import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLog } from "../logging/LogProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useApiClient } from "./ApiClientProvider";

interface NetworkStateContextValue {
  online: boolean;
}

const NetworkStateContext = createContext<NetworkStateContextValue | null>(
  null,
);

export function NetworkStateProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const [online, setOnlineState] = useState(tearleads.network.online);
  const apiClient = useApiClient();
  const { log } = useLog();
  const wasOnlineRef = useRef(tearleads.network.online);

  const setOnline = useCallback(
    (nextOnline: boolean) => {
      tearleads.network.setOnline(nextOnline);
      setOnlineState(nextOnline);
    },
    [tearleads],
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    apiClient.setOnNetworkError(goOffline);
    apiClient.setOnNetworkSuccess(goOnline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      apiClient.setOnNetworkError(null);
      apiClient.setOnNetworkSuccess(null);
    };
  }, [apiClient, setOnline]);

  useEffect(() => {
    if (online && !wasOnlineRef.current) {
      log("Network online");
    } else if (!online && wasOnlineRef.current) {
      log("Network offline");
    }
    wasOnlineRef.current = online;
  }, [online, log]);

  return (
    <NetworkStateContext.Provider value={{ online }}>
      {children}
    </NetworkStateContext.Provider>
  );
}

export function useNetworkState(): NetworkStateContextValue {
  const ctx = useContext(NetworkStateContext);
  if (!ctx) {
    throw new Error(
      "useNetworkState must be used within a NetworkStateProvider.",
    );
  }
  return ctx;
}

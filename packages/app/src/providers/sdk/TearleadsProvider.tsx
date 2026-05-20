import { Tearleads } from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import { APP_DOCUMENT_PROJECTOR_REGISTRY } from "../../document-types/projectors";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLog } from "../logging/LogProvider";

const TearleadsContext = createContext<Tearleads | null>(null);

function useBrowserNetworkBinding(tearleads: Tearleads): void {
  useEffect(() => {
    const goOnline = () => tearleads.network.setOnline(true);
    const goOffline = () => tearleads.network.setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [tearleads]);
}

function useNetworkTransitionLog(tearleads: Tearleads): void {
  const { log } = useLog();

  useEffect(
    () =>
      tearleads.network.subscribe((online) => {
        log(online ? "Network online" : "Network offline");
      }),
    [log, tearleads],
  );
}

export function TearleadsProvider({ children }: PropsWithChildren) {
  const hostConfig = useAppHostConfig();
  const { log, logError } = useLog();
  const [tearleads] = useState(
    () =>
      new Tearleads({
        apiBaseUrl: hostConfig.apiBaseUrl,
        documentProjectors: APP_DOCUMENT_PROJECTOR_REGISTRY,
        logger: { log, logError },
      }),
  );
  useBrowserNetworkBinding(tearleads);
  useNetworkTransitionLog(tearleads);

  return (
    <TearleadsContext.Provider value={tearleads}>
      {children}
    </TearleadsContext.Provider>
  );
}

export function useTearleads(): Tearleads {
  const context = useContext(TearleadsContext);
  if (!context) {
    throw new Error("useTearleads must be used within a TearleadsProvider.");
  }

  return context;
}

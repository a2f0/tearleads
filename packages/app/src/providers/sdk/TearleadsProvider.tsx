import { Tearleads } from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from "react";
import { APP_DOCUMENT_PROJECTOR_REGISTRY } from "../../document-types/projectors";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLog } from "../logging/LogProvider";

const TearleadsContext = createContext<Tearleads | null>(null);

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

import { ApiClient } from "@tearleads/api-client";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLog } from "../logging/LogProvider";

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({ children }: PropsWithChildren) {
  const hostConfig = useAppHostConfig();
  const [client] = useState(() => new ApiClient(hostConfig.apiBaseUrl));
  const { logError } = useLog();

  useEffect(() => {
    client.setOnError(logError);
    return () => {
      client.setOnError(null);
    };
  }, [client, logError]);

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): ApiClient {
  const ctx = useContext(ApiClientContext);
  if (!ctx) {
    throw new Error("useApiClient must be used within an ApiClientProvider.");
  }
  return ctx;
}

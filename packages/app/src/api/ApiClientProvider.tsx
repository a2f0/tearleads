import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import { useLog } from "../logging/LogProvider";
import { ApiClient } from "./ApiClient";

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({ children }: PropsWithChildren) {
  const [client] = useState(() => new ApiClient());
  const { log } = useLog();

  useEffect(() => {
    client.setOnError(log);
  }, [client, log]);

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

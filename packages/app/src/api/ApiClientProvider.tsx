import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from "react";
import { ApiClient } from "./ApiClient";

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({ children }: PropsWithChildren) {
  const [client] = useState(() => new ApiClient());
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

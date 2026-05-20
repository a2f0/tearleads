import type { ApiClient } from "@tearleads/api-client";
import { createContext, type PropsWithChildren, useContext } from "react";
import { useTearleads } from "../sdk/TearleadsProvider";

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const client = tearleads.api;

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

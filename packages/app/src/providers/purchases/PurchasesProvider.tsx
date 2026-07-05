import {
  createUnavailablePurchases,
  type PurchasesCapability,
} from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";

const PurchasesContext = createContext<PurchasesCapability | null>(null);

/**
 * Exposes the platform's {@link PurchasesCapability} to the app. The concrete
 * capability is injected by the platform shell through
 * `AppHostConfig.createPurchases` (mirroring `createSQLiteRuntime` /
 * `createLocalKeyring`); shells without an in-app-purchase provider fall back to
 * the unavailable stub, so `usePurchases()` is always safe to call and billing UI
 * gates on `isAvailable`.
 */
export function PurchasesProvider({ children }: PropsWithChildren) {
  const { createPurchases } = useAppHostConfig();
  const purchases = useMemo(
    () => (createPurchases ? createPurchases() : createUnavailablePurchases()),
    [createPurchases],
  );
  return (
    <PurchasesContext.Provider value={purchases}>
      {children}
    </PurchasesContext.Provider>
  );
}

export function usePurchases() {
  const context = useContext(PurchasesContext);
  if (!context) {
    throw new Error("usePurchases must be used within a PurchasesProvider.");
  }
  return context;
}

import {
  createUnavailablePurchases,
  type PurchasesCapability,
} from "@symcrypt/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useRef,
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
 *
 * The capability is constructed exactly once per mount via a ref: it wraps a
 * long-lived provider session (RevenueCat is configured lazily on first use), so
 * it must not be rebuilt on re-render.
 */
export function PurchasesProvider({ children }: PropsWithChildren) {
  const { createPurchases } = useAppHostConfig();
  const purchasesRef = useRef<PurchasesCapability | null>(null);
  if (!purchasesRef.current) {
    purchasesRef.current = createPurchases
      ? createPurchases()
      : createUnavailablePurchases();
  }
  return (
    <PurchasesContext.Provider value={purchasesRef.current}>
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

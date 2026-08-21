import {
  createUnavailableDirectCheckout,
  type DirectCheckoutCapability,
} from "@symcrypt/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useRef,
} from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";

const DirectCheckoutContext = createContext<DirectCheckoutCapability | null>(
  null,
);

/**
 * Exposes the platform's {@link DirectCheckoutCapability} — the in-app card
 * form (issue #1654) — mirroring `PurchasesProvider`. Shells without a
 * payment-element provider fall back to the unavailable stub, so
 * `useDirectCheckout()` is always safe to call and billing UI gates on
 * `isAvailable`.
 *
 * Built exactly once per mount via a ref: the capability lazily loads the
 * provider script and caches it, so it must not be rebuilt on re-render.
 */
export function DirectCheckoutProvider({ children }: PropsWithChildren) {
  const { createDirectCheckout } = useAppHostConfig();
  const checkoutRef = useRef<DirectCheckoutCapability | null>(null);
  if (!checkoutRef.current) {
    checkoutRef.current = createDirectCheckout
      ? createDirectCheckout()
      : createUnavailableDirectCheckout();
  }
  return (
    <DirectCheckoutContext.Provider value={checkoutRef.current}>
      {children}
    </DirectCheckoutContext.Provider>
  );
}

export function useDirectCheckout() {
  const context = useContext(DirectCheckoutContext);
  if (!context) {
    throw new Error(
      "useDirectCheckout must be used within a DirectCheckoutProvider.",
    );
  }
  return context;
}

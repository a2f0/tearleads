import { mock, spyOn } from "bun:test";
import type {
  DirectCheckoutCapability,
  DirectCheckoutSession,
} from "@tearleads/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createAppHostConfig } from "../../src/host/AppHostConfig";
import { useDirectCheckoutFlow } from "../../src/mini-apps/org-manager/billing/useDirectCheckout";
import { DirectCheckoutProvider } from "../../src/providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../src/providers/host/AppHostConfigProvider";
import * as TearleadsProvider from "../../src/providers/sdk/TearleadsProvider";

// spyOn patches the shared module namespace; bun runs every test file in one
// process, so an unrestored spy would hand OTHER suites a stub Tearleads
// client (and fail them on a missing store). Restore after each test.
const spies: { mockRestore: () => void }[] = [];
export function restoreDirectCheckoutSpies() {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
  cleanup();
}
export const OPTION = {
  tierId: "solo" as const,
  seatLimit: 1,
  priceId: "price_1",
  productName: "Sync",
  currency: "usd",
  unitAmount: 99,
  interval: "month",
  intervalCount: 1,
};
type MountInput = Parameters<DirectCheckoutCapability["mount"]>[0];

export function stubTearleads(overrides?: {
  createStripeCheckout?: () => Promise<unknown>;
}) {
  const organizations = {
    loadStripeCheckoutOptions: mock(() =>
      Promise.resolve({ options: [OPTION] }),
    ),
    createStripeCheckout:
      overrides?.createStripeCheckout ??
      mock(() =>
        Promise.resolve({ subscriptionId: "sub_1", clientSecret: "pi_secret" }),
      ),
  };
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations,
    } as never),
  );
  return organizations;
}

export function capabilityWith(session: Partial<DirectCheckoutSession>): {
  capability: DirectCheckoutCapability;
  mounted: MountInput[];
} {
  const mounted: MountInput[] = [];
  const capability: DirectCheckoutCapability = {
    isAvailable: true,
    mount: mock((input: MountInput) => {
      mounted.push(input);
      return Promise.resolve({
        confirm:
          session.confirm ?? (() => Promise.resolve({ kind: "succeeded" })),
        unmount: session.unmount ?? (() => undefined),
      } as DirectCheckoutSession);
    }) as DirectCheckoutCapability["mount"],
  };
  return { capability, mounted };
}

export function renderFlow(
  capability: DirectCheckoutCapability,
  onActivated: () => void = () => undefined,
  organizationId = "org-1",
) {
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    createDirectCheckout: () => capability,
    wsUrl: "ws://localhost",
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <AppHostConfigProvider value={hostConfig}>
      <DirectCheckoutProvider>{children}</DirectCheckoutProvider>
    </AppHostConfigProvider>
  );
  const rendered = renderHook(
    () =>
      useDirectCheckoutFlow({
        canSubscribe: true,
        enabled: true,
        organizationId,
        onPaid: onActivated,
      }),
    { wrapper },
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  rendered.result.current.hostRef.current = host;
  return { ...rendered, host };
}

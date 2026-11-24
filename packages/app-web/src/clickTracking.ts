import { createTracker, type Tracker } from "@a2f0/ct-client";
import type { CollectionConsent } from "@tearleads/diagnostics/browser";

const hosts = new Map<
  string,
  {
    readonly app: "web-app" | "demo";
    readonly environment: "production" | "staging";
  }
>([
  ["https://app.tearleads.com", { app: "web-app", environment: "production" }],
  ["https://demo.tearleads.com", { app: "demo", environment: "production" }],
  [
    "https://app-staging.tearleads.com",
    { app: "web-app", environment: "staging" },
  ],
  [
    "https://demo-staging.tearleads.com",
    { app: "demo", environment: "staging" },
  ],
] as const);

let tracker: Tracker | undefined;

/**
 * Only the hosted browser entry calls this; reusable and native apps stay
 * inert. Capture runs only while the user consents to anonymous telemetry:
 * withdrawing it stops capture and discards queued clicks.
 */
export function initializeClickTracking(
  productionBuild: boolean,
  consent: CollectionConsent,
): void {
  if (!productionBuild || tracker || typeof window === "undefined") return;
  const host = hosts.get(window.location.origin);
  if (!host) return;
  const created = createTracker({
    site: "tearleads",
    ...host,
    capture: "all",
    overrideGpc: false,
    // App routes can contain private organization, document, and workflow IDs.
    page: () => "/",
  });
  tracker = created;
  const follow = () => {
    if (consent.enabled()) created.init();
    else created.destroy();
  };
  follow();
  consent.subscribe(follow);
}

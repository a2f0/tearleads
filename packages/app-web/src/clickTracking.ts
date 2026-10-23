import { createTracker, type Tracker } from "@a2f0/ct-client";

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

/** Only the hosted browser entry calls this; reusable and native apps stay inert. */
export function initializeClickTracking(productionBuild: boolean): void {
  if (!productionBuild || tracker || typeof window === "undefined") return;
  const host = hosts.get(window.location.origin);
  if (!host) return;
  tracker = createTracker({
    site: "tearleads",
    ...host,
    capture: "all",
    overrideGpc: false,
    // App routes can contain private organization, document, and workflow IDs.
    page: () => "/",
  });
  tracker.init();
}

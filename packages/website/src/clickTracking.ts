import { createTracker, type Tracker } from "@a2f0/ct-client";

const environments = new Map<string, "production" | "staging">([
  ["https://tearleads.com", "production"],
  ["https://website-staging.tearleads.com", "staging"],
] as const);

let tracker: Tracker | undefined;

/** Astro's shared layout initializes the collector only in hosted builds. */
export function initializeClickTracking(productionBuild: boolean): void {
  if (!productionBuild || tracker || typeof window === "undefined") return;
  const environment = environments.get(window.location.origin);
  if (!environment) return;
  tracker = createTracker({
    site: "tearleads",
    app: "website",
    environment,
    capture: "all",
    overrideGpc: false,
    page: () => "/",
  });
  tracker.init();
}

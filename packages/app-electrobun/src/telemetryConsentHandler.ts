import {
  ELECTROBUN_TELEMETRY_CONSENT_HEADER,
  ELECTROBUN_TELEMETRY_CONSENT_PATH,
} from "./telemetryConsentBridge";

// What the Bun server should do with an incoming request: `ignore` — not our
// route; `reject` — a malformed report; `set` — the choice the renderer reports.
type TelemetryConsentPlan =
  | { readonly kind: "ignore" }
  | { readonly kind: "reject"; readonly status: number }
  | { readonly kind: "set"; readonly enabled: boolean };

/** Pure, so the routing and the CSRF gate are testable without Bun. */
export function planTelemetryConsentRequest(
  req: Request,
): TelemetryConsentPlan {
  const { pathname } = new URL(req.url);
  if (req.method !== "POST" || pathname !== ELECTROBUN_TELEMETRY_CONSENT_PATH) {
    return { kind: "ignore" };
  }
  const value = req.headers.get(ELECTROBUN_TELEMETRY_CONSENT_HEADER);
  return value === "enabled" || value === "disabled"
    ? { kind: "set", enabled: value === "enabled" }
    : { kind: "reject", status: 400 };
}

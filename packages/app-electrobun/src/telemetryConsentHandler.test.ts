import { expect, test } from "bun:test";
import {
  ELECTROBUN_TELEMETRY_CONSENT_HEADER,
  ELECTROBUN_TELEMETRY_CONSENT_PATH,
} from "./telemetryConsentBridge";
import { planTelemetryConsentRequest } from "./telemetryConsentHandler";

const ORIGIN = "http://127.0.0.1:3002";

function consentRequest(
  value: string | null,
  { method = "POST", path = ELECTROBUN_TELEMETRY_CONSENT_PATH } = {},
): Request {
  const headers = new Headers();
  if (value !== null) headers.set(ELECTROBUN_TELEMETRY_CONSENT_HEADER, value);
  return new Request(`${ORIGIN}${path}`, { headers, method });
}

test("the renderer's report sets the main process's choice", () => {
  expect(planTelemetryConsentRequest(consentRequest("enabled"))).toEqual({
    kind: "set",
    enabled: true,
  });
  expect(planTelemetryConsentRequest(consentRequest("disabled"))).toEqual({
    kind: "set",
    enabled: false,
  });
});

test("a post without the header cannot opt the user in", () => {
  // What a cross-origin simple POST looks like: it cannot set the header.
  for (const value of [null, "", "true", "Enabled"]) {
    expect(planTelemetryConsentRequest(consentRequest(value))).toEqual({
      kind: "reject",
      status: 400,
    });
  }
});

test("other routes and methods pass through to the app server", () => {
  expect(
    planTelemetryConsentRequest(consentRequest("enabled", { method: "GET" })),
  ).toEqual({ kind: "ignore" });
  expect(
    planTelemetryConsentRequest(
      consentRequest("enabled", { path: "/__electrobun/save-file" }),
    ),
  ).toEqual({ kind: "ignore" });
});

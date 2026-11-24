import { afterEach, expect, test } from "bun:test";
import {
  createTelemetryConsent,
  TELEMETRY_CONSENT_STORAGE_KEY,
} from "./telemetryConsent";

afterEach(() => {
  globalThis.localStorage.clear();
});

// What another tab's write looks like to this one.
function otherTabWrites(value: string | null) {
  if (value === null) globalThis.localStorage.clear();
  else globalThis.localStorage.setItem(TELEMETRY_CONSENT_STORAGE_KEY, value);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: value === null ? null : TELEMETRY_CONSENT_STORAGE_KEY,
    }),
  );
}

test("telemetry is off until the user turns it on, and the choice persists", () => {
  const consent = createTelemetryConsent();
  expect(consent.enabled()).toBe(false);

  let notified = 0;
  consent.subscribe(() => notified++);
  consent.setEnabled(true);
  expect(consent.enabled()).toBe(true);
  expect(notified).toBe(1);
  expect(globalThis.localStorage.getItem(TELEMETRY_CONSENT_STORAGE_KEY)).toBe(
    "enabled",
  );
  expect(createTelemetryConsent().enabled()).toBe(true);

  consent.setEnabled(true);
  expect(notified).toBe(1);
  consent.setEnabled(false);
  expect(notified).toBe(2);
  expect(createTelemetryConsent().enabled()).toBe(false);
});

test("an unrecognized stored value reads as off", () => {
  globalThis.localStorage.setItem(TELEMETRY_CONSENT_STORAGE_KEY, "true");
  expect(createTelemetryConsent().enabled()).toBe(false);
});

test("another tab's change reaches this one, and a cleared store reads as off", () => {
  const consent = createTelemetryConsent();
  const seen: boolean[] = [];
  const unsubscribe = consent.subscribe(() => seen.push(consent.enabled()));

  otherTabWrites("enabled");
  expect(consent.enabled()).toBe(true);
  window.dispatchEvent(new StorageEvent("storage", { key: "tearleads.theme" }));
  otherTabWrites(null);
  expect(consent.enabled()).toBe(false);
  expect(seen).toEqual([true, false]);

  // With nothing subscribed it stops listening, then catches up on return.
  unsubscribe();
  otherTabWrites("enabled");
  expect(seen).toEqual([true, false]);
  consent.subscribe(() => seen.push(consent.enabled()));
  expect(consent.enabled()).toBe(true);
});

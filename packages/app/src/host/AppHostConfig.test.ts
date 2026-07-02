import { afterEach, expect, test } from "bun:test";
import {
  APP_HOST_PROFILES,
  resolveAppHostProfile,
  resolveEventsWebSocketUrl,
} from "./AppHostConfig";

const originalLocation = Object.getOwnPropertyDescriptor(
  globalThis,
  "location",
);

function setLocationHref(href: string): void {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href },
  });
}

afterEach(() => {
  if (originalLocation) {
    Object.defineProperty(globalThis, "location", originalLocation);
  } else {
    Reflect.deleteProperty(globalThis, "location");
  }
});

test("resolveAppHostProfile returns the app profile when the variant is unset", () => {
  expect(resolveAppHostProfile(undefined)).toBe(APP_HOST_PROFILES.app);
});

test("resolveAppHostProfile treats an empty string as unset", () => {
  // Some bundlers emit "" for an unset env var rather than undefined; that must
  // fall back to the default profile instead of crashing startup.
  expect(resolveAppHostProfile("")).toBe(APP_HOST_PROFILES.app);
});

test("resolveAppHostProfile resolves a known variant id", () => {
  expect(resolveAppHostProfile("app")).toBe(APP_HOST_PROFILES.app);
  expect(resolveAppHostProfile("demo")).toBe(APP_HOST_PROFILES.demo);
});

test("app and demo profiles auto-provision identities", () => {
  // Both productionized variants derive a key pair and register + log in on
  // boot; the autopilot reads these flags.
  for (const profile of [APP_HOST_PROFILES.app, APP_HOST_PROFILES.demo]) {
    expect(profile.features.autoGenerateIdentity).toBe(true);
    expect(profile.features.autoRegisterIdentity).toBe(true);
  }
});

test("only the demo profile seeds friendly peer identities", () => {
  // The friendly peer bootstrap (auto-imported peer contact, "Peer N" self /
  // org names) is demo-only sugar; the regular app keeps the neutral defaults.
  expect(APP_HOST_PROFILES.app.features.seedPeerIdentities).toBe(false);
  expect(APP_HOST_PROFILES.demo.features.seedPeerIdentities).toBe(true);
});

test("resolveAppHostProfile throws on an unknown variant id", () => {
  // Fail closed: a misconfigured variant must surface loudly rather than
  // silently shipping the wrong profile to a domain.
  expect(() => resolveAppHostProfile("notes")).toThrow(
    "Unknown app host variant: notes",
  );
});

test("resolveEventsWebSocketUrl derives the events path from the API URL", () => {
  expect(resolveEventsWebSocketUrl("https://api.tearleads.com")).toBe(
    "wss://api.tearleads.com/events",
  );
  expect(resolveEventsWebSocketUrl("http://localhost:3001")).toBe(
    "ws://localhost:3001/events",
  );
  expect(resolveEventsWebSocketUrl("https://tearleads.com/api")).toBe(
    "wss://tearleads.com/api/events",
  );
  expect(resolveEventsWebSocketUrl("https://tearleads.com/api/")).toBe(
    "wss://tearleads.com/api/events",
  );
});

test("resolveEventsWebSocketUrl derives relative API URLs from the current location", () => {
  setLocationHref("https://app.tearleads.test/workspace");

  expect(resolveEventsWebSocketUrl("/api")).toBe(
    "wss://app.tearleads.test/api/events",
  );
});

test("resolveEventsWebSocketUrl normalizes explicit root websocket URLs", () => {
  expect(
    resolveEventsWebSocketUrl(
      "https://api.tearleads.com",
      "wss://api.tearleads.com",
    ),
  ).toBe("wss://api.tearleads.com/events");
});

test("resolveEventsWebSocketUrl preserves explicit websocket paths", () => {
  expect(
    resolveEventsWebSocketUrl(
      "https://api.tearleads.com",
      "wss://events.tearleads.com/socket",
    ),
  ).toBe("wss://events.tearleads.com/socket");
});

test("resolveEventsWebSocketUrl preserves explicit relative websocket paths", () => {
  setLocationHref("https://app.tearleads.test/workspace");

  expect(resolveEventsWebSocketUrl("/api", "/ws")).toBe(
    "wss://app.tearleads.test/ws",
  );
});

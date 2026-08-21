import { afterEach, expect, test } from "bun:test";
import {
  APP_HOST_PROFILES,
  createAppHostConfig,
  resolveAppHostProfile,
  resolveAppHostRuntimeConfig,
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
  expect(resolveAppHostProfile("screenshot")).toBe(
    APP_HOST_PROFILES.screenshot,
  );
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

test("screenshot profile defers registration until its fixture is restored", () => {
  expect(APP_HOST_PROFILES.screenshot.features.autoGenerateIdentity).toBe(true);
  expect(APP_HOST_PROFILES.screenshot.features.autoRegisterIdentity).toBe(
    false,
  );
});

test("resolveAppHostProfile throws on an unknown variant id", () => {
  // Fail closed: a misconfigured variant must surface loudly rather than
  // silently shipping the wrong profile to a domain.
  expect(() => resolveAppHostProfile("notes")).toThrow(
    "Unknown app host variant: notes",
  );
});

test("resolveEventsWebSocketUrl derives the events path from the API URL", () => {
  expect(resolveEventsWebSocketUrl("https://api.symcrypt.com")).toBe(
    "wss://api.symcrypt.com/events",
  );
  expect(resolveEventsWebSocketUrl("http://localhost:3001")).toBe(
    "ws://localhost:3001/events",
  );
  expect(resolveEventsWebSocketUrl("https://symcrypt.com/api")).toBe(
    "wss://symcrypt.com/api/events",
  );
  expect(resolveEventsWebSocketUrl("https://symcrypt.com/api/")).toBe(
    "wss://symcrypt.com/api/events",
  );
});

test("resolveEventsWebSocketUrl derives relative API URLs from the current location", () => {
  setLocationHref("https://app.symcrypt.test/workspace");

  expect(resolveEventsWebSocketUrl("/api")).toBe(
    "wss://app.symcrypt.test/api/events",
  );
});

test("resolveEventsWebSocketUrl preserves explicit websocket URLs", () => {
  expect(
    resolveEventsWebSocketUrl(
      "https://api.symcrypt.com",
      "wss://api.symcrypt.com",
    ),
  ).toBe("wss://api.symcrypt.com/");
  expect(
    resolveEventsWebSocketUrl(
      "https://api.symcrypt.com",
      "wss://api.symcrypt.com/events",
    ),
  ).toBe("wss://api.symcrypt.com/events");
});

test("resolveEventsWebSocketUrl preserves explicit relative websocket paths", () => {
  setLocationHref("https://app.symcrypt.test/workspace");

  expect(resolveEventsWebSocketUrl("/api", "/ws")).toBe(
    "wss://app.symcrypt.test/ws",
  );
});

test("resolveAppHostRuntimeConfig falls back to the localhost dev backend when unset", () => {
  // The three shells inline env through three different bundlers, and each emits
  // undefined or "" for an unset var; both must collapse to the one shared dev
  // default rather than crash a shell that forgot to set it.
  for (const apiBaseUrl of [undefined, "", "   "]) {
    expect(resolveAppHostRuntimeConfig({ apiBaseUrl })).toEqual({
      apiBaseUrl: "http://localhost:3001",
      wsUrl: "ws://localhost:3001/events",
    });
  }
});

test("resolveAppHostRuntimeConfig derives the websocket URL from an explicit API URL", () => {
  expect(
    resolveAppHostRuntimeConfig({ apiBaseUrl: "https://api.symcrypt.com" }),
  ).toEqual({
    apiBaseUrl: "https://api.symcrypt.com",
    wsUrl: "wss://api.symcrypt.com/events",
  });
});

test("resolveAppHostRuntimeConfig honours an explicit websocket override", () => {
  expect(
    resolveAppHostRuntimeConfig({
      apiBaseUrl: "https://api.symcrypt.com",
      wsUrl: "wss://api.symcrypt.com/events",
    }),
  ).toEqual({
    apiBaseUrl: "https://api.symcrypt.com",
    wsUrl: "wss://api.symcrypt.com/events",
  });
});

test("resolveAppHostRuntimeConfig trims surrounding whitespace before resolving", () => {
  // A blank-but-present websocket override must not win over the derived URL.
  expect(
    resolveAppHostRuntimeConfig({
      apiBaseUrl: "  https://api.symcrypt.com  ",
      wsUrl: "   ",
    }),
  ).toEqual({
    apiBaseUrl: "https://api.symcrypt.com",
    wsUrl: "wss://api.symcrypt.com/events",
  });
});

test("withOverrides clones from a spread-composed copy, not the original", () => {
  // Callers compose configs by spreading (`{ ...config, extra }`); the carried
  // withOverrides must then clone from the copy's own fields so the spread
  // additions survive a later clone (e.g. Layout re-deriving the config).
  const base = createAppHostConfig({
    apiBaseUrl: "https://api.example.test",
    wsUrl: "wss://events.example.test",
  });
  const composed = { ...base, localIdentityNamespace: "composed-namespace" };

  const cloned = composed.withOverrides({
    apiBaseUrl: "https://api2.example.test",
  });

  expect(cloned.localIdentityNamespace).toBe("composed-namespace");
  expect(cloned.apiBaseUrl).toBe("https://api2.example.test");
  expect(cloned.wsUrl).toBe("wss://events.example.test");
});

test("withOverrides resets a field via an explicit undefined override", () => {
  const base = createAppHostConfig({
    apiBaseUrl: "https://api.example.test",
    localIdentityNamespace: "original",
    wsUrl: "wss://events.example.test",
  });

  const cleared = base.withOverrides({ localIdentityNamespace: undefined });

  expect(cleared.localIdentityNamespace).toBeUndefined();
});

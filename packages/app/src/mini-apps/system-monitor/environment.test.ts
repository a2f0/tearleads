import { expect, test } from "bun:test";
import {
  applyHighEntropyHints,
  formatIdentity,
  parseBrowserFromUserAgent,
  parseOsFromUserAgent,
  resolveWindowsVersion,
  UNKNOWN_ENVIRONMENT_VALUE,
} from "./environment";

const USER_AGENTS = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  linuxFirefox:
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  windowsFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  windowsOpera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 OPR/99.0.0.0",
} as const;

test("browser parsing prefers the specific brand over the engine it embeds", () => {
  // Every one of these also carries a "Chrome/" token; the generic Chrome
  // matcher must not win.
  expect(parseBrowserFromUserAgent(USER_AGENTS.windowsEdge)).toEqual({
    name: "Edge",
    version: "141.0.0.0",
  });
  expect(parseBrowserFromUserAgent(USER_AGENTS.windowsOpera)).toEqual({
    name: "Opera",
    version: "99.0.0.0",
  });
  expect(parseBrowserFromUserAgent(USER_AGENTS.androidSamsung)).toEqual({
    name: "Samsung Internet",
    version: "23.0",
  });
});

test("browser parsing reads Safari's marketing version, not its WebKit build", () => {
  expect(parseBrowserFromUserAgent(USER_AGENTS.macSafari)).toEqual({
    name: "Safari",
    version: "18.5",
  });
  expect(parseBrowserFromUserAgent(USER_AGENTS.iosSafari)).toEqual({
    name: "Safari",
    version: "17.5",
  });
});

test("browser parsing distinguishes iOS wrappers from their desktop namesakes", () => {
  expect(parseBrowserFromUserAgent(USER_AGENTS.iosChrome)).toEqual({
    name: "Chrome (iOS)",
    version: "141.0.0.0",
  });
});

test("browser parsing covers the mainstream desktop browsers", () => {
  expect(parseBrowserFromUserAgent(USER_AGENTS.macChrome)).toEqual({
    name: "Chrome",
    version: "141.0.0.0",
  });
  expect(parseBrowserFromUserAgent(USER_AGENTS.windowsFirefox)).toEqual({
    name: "Firefox",
    version: "130.0",
  });
});

test("browser parsing falls back to unknown rather than guessing", () => {
  expect(parseBrowserFromUserAgent("some-unrecognized-agent/1.0")).toEqual({
    name: UNKNOWN_ENVIRONMENT_VALUE,
    version: UNKNOWN_ENVIRONMENT_VALUE,
  });
});

test("os parsing prefers the mobile OS over the platform it reports underneath", () => {
  // Android user-agents also say "Linux"; iOS ones also say "like Mac OS X".
  expect(parseOsFromUserAgent(USER_AGENTS.androidChrome)).toEqual({
    name: "Android",
    version: "14",
  });
  expect(parseOsFromUserAgent(USER_AGENTS.iosSafari)).toEqual({
    name: "iOS",
    version: "17.5.1",
  });
});

test("os parsing covers the desktop platforms", () => {
  expect(parseOsFromUserAgent(USER_AGENTS.macSafari)).toEqual({
    name: "macOS",
    version: "10.15.7",
  });
  expect(parseOsFromUserAgent(USER_AGENTS.windowsEdge)).toEqual({
    name: "Windows",
    version: "10.0",
  });
  expect(parseOsFromUserAgent(USER_AGENTS.linuxFirefox)).toEqual({
    name: "Linux",
    version: UNKNOWN_ENVIRONMENT_VALUE,
  });
});

test("windows 11 is resolved from the client hint the user-agent cannot express", () => {
  // Windows 11 still reports "Windows NT 10.0" in the user-agent string.
  expect(resolveWindowsVersion("13.0.0")).toBe("11");
  expect(resolveWindowsVersion("15.0.0")).toBe("11");
  expect(resolveWindowsVersion("12.0.0")).toBe("10");
  expect(resolveWindowsVersion("1.0.0")).toBe("10");
  expect(resolveWindowsVersion("0.0.0")).toBe("8.1 or earlier");
  expect(resolveWindowsVersion("garbage")).toBe(UNKNOWN_ENVIRONMENT_VALUE);
});

test("high-entropy hints override the frozen user-agent os version", () => {
  // Chromium pins every macOS user-agent to 10_15_7; the hint carries the truth.
  const frozen = parseOsFromUserAgent(USER_AGENTS.macChrome);
  expect(frozen.version).toBe("10.15.7");
  expect(applyHighEntropyHints(frozen, { platformVersion: "15.5.0" })).toEqual({
    name: "macOS",
    version: "15.5.0",
  });

  expect(
    applyHighEntropyHints(parseOsFromUserAgent(USER_AGENTS.windowsEdge), {
      platformVersion: "13.0.0",
    }),
  ).toEqual({ name: "Windows", version: "11" });
});

test("high-entropy hints are ignored when absent, leaving the parse intact", () => {
  const parsed = parseOsFromUserAgent(USER_AGENTS.macSafari);
  expect(applyHighEntropyHints(parsed, {})).toEqual(parsed);
  expect(applyHighEntropyHints(parsed, { platformVersion: "" })).toEqual(
    parsed,
  );
});

test("identity formatting drops versions it does not know", () => {
  expect(formatIdentity({ name: "Chrome", version: "141.0.0.0" })).toBe(
    "Chrome 141.0.0.0",
  );
  expect(
    formatIdentity({ name: "Linux", version: UNKNOWN_ENVIRONMENT_VALUE }),
  ).toBe("Linux");
  expect(
    formatIdentity({
      name: UNKNOWN_ENVIRONMENT_VALUE,
      version: UNKNOWN_ENVIRONMENT_VALUE,
    }),
  ).toBe(UNKNOWN_ENVIRONMENT_VALUE);
});

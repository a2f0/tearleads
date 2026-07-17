/**
 * User-agent parsing for the System Monitor's Environment tab.
 *
 * Kept pure and separate from the hook so the matcher tables can be tested
 * against real user-agent strings without a DOM.
 *
 * Parsing a user-agent string is guesswork by nature, which is why the raw
 * string is always reported alongside the parse: when a matcher is wrong or a
 * new browser appears, support still has the ground truth to read.
 */

export const UNKNOWN_ENVIRONMENT_VALUE = "unknown";

interface BrowserIdentity {
  readonly name: string;
  readonly version: string;
}

interface OsIdentity {
  readonly name: string;
  readonly version: string;
}

interface UserAgentMatcher {
  readonly name: string;
  readonly pattern: RegExp;
}

// Order matters: every Chromium-based browser also claims "Chrome", and both
// Chrome and Firefox on iOS are Safari underneath, so the specific brands must
// be tested before the generic engines they embed.
const BROWSER_MATCHERS: ReadonlyArray<UserAgentMatcher> = [
  { name: "Edge", pattern: /Edg(?:e|A|iOS)?\/([\d.]+)/u },
  { name: "Opera", pattern: /OPR\/([\d.]+)/u },
  { name: "Samsung Internet", pattern: /SamsungBrowser\/([\d.]+)/u },
  // Chrome and Firefox on iOS: different brand tokens, still WebKit underneath.
  { name: "Chrome (iOS)", pattern: /CriOS\/([\d.]+)/u },
  { name: "Firefox (iOS)", pattern: /FxiOS\/([\d.]+)/u },
  { name: "Firefox", pattern: /Firefox\/([\d.]+)/u },
  { name: "Chrome", pattern: /Chrome\/([\d.]+)/u },
  // Safari reports its marketing version in `Version/`, not in the `Safari/`
  // token, which carries a WebKit build number instead.
  { name: "Safari", pattern: /Version\/([\d.]+).*Safari\//u },
];

export function parseBrowserFromUserAgent(userAgent: string): BrowserIdentity {
  for (const matcher of BROWSER_MATCHERS) {
    const match = matcher.pattern.exec(userAgent);
    if (match?.[1]) {
      return { name: matcher.name, version: match[1] };
    }
  }

  return {
    name: UNKNOWN_ENVIRONMENT_VALUE,
    version: UNKNOWN_ENVIRONMENT_VALUE,
  };
}

export function parseOsFromUserAgent(userAgent: string): OsIdentity {
  // iOS/iPadOS write the version with underscores ("OS 17_5_1").
  const ios = /(?:iPhone|iPad|iPod).*?OS (\d+(?:_\d+)*)/u.exec(userAgent);
  if (ios?.[1]) {
    return { name: "iOS", version: ios[1].replaceAll("_", ".") };
  }

  const android = /Android (\d+(?:\.\d+)*)/u.exec(userAgent);
  if (android?.[1]) {
    return { name: "Android", version: android[1] };
  }

  const macOs = /Mac OS X (\d+(?:[._]\d+)*)/u.exec(userAgent);
  if (macOs?.[1]) {
    return { name: "macOS", version: macOs[1].replaceAll("_", ".") };
  }

  if (/CrOS/u.test(userAgent)) {
    return { name: "ChromeOS", version: UNKNOWN_ENVIRONMENT_VALUE };
  }

  const windows = /Windows NT (\d+(?:\.\d+)*)/u.exec(userAgent);
  if (windows?.[1]) {
    return { name: "Windows", version: windows[1] };
  }

  if (/Linux/u.test(userAgent)) {
    return { name: "Linux", version: UNKNOWN_ENVIRONMENT_VALUE };
  }

  return {
    name: UNKNOWN_ENVIRONMENT_VALUE,
    version: UNKNOWN_ENVIRONMENT_VALUE,
  };
}

/**
 * Maps a UA-CH `platformVersion` onto a Windows marketing version.
 *
 * Windows 11 still reports "Windows NT 10.0" in its user-agent string, so the
 * UA alone cannot tell 10 from 11. The client hint can: Microsoft ships the
 * OS build major as the platform version, where 1-12 is Windows 10 and 13+ is
 * Windows 11.
 */
export function resolveWindowsVersion(platformVersion: string): string {
  const major = Number.parseInt(platformVersion.split(".")[0] ?? "", 10);
  if (Number.isNaN(major)) {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  if (major === 0) {
    // Pre-Windows-10 releases all report 0 and are not distinguishable here.
    return "8.1 or earlier";
  }
  return major >= 13 ? "11" : "10";
}

/**
 * Refines a user-agent parse with UA-CH high-entropy hints.
 *
 * Chromium freezes the OS version in the user-agent string — every macOS
 * Chrome claims "10_15_7" regardless of the real version, and Windows 11 claims
 * "Windows NT 10.0". Reporting those verbatim would put confidently wrong data
 * in a support report, so where the hints are available they win.
 */
export function applyHighEntropyHints(
  os: OsIdentity,
  hints: { readonly platformVersion?: string | undefined },
): OsIdentity {
  const { platformVersion } = hints;
  if (platformVersion === undefined || platformVersion === "") {
    return os;
  }

  if (os.name === "Windows") {
    return { name: os.name, version: resolveWindowsVersion(platformVersion) };
  }

  return { name: os.name, version: platformVersion };
}

export function formatIdentity(identity: BrowserIdentity | OsIdentity): string {
  if (identity.name === UNKNOWN_ENVIRONMENT_VALUE) {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  if (identity.version === UNKNOWN_ENVIRONMENT_VALUE) {
    return identity.name;
  }
  return `${identity.name} ${identity.version}`;
}

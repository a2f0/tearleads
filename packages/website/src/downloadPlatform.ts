/**
 * Home's download list (DownloadList.astro) is built in one fixed order. This
 * moves the row for the visitor's operating system to the top, so a phone sees
 * its store link first. Without scripting, or on a platform with no row, the
 * built order stays.
 */

export type DownloadPlatform =
  | "macos"
  | "linux"
  | "windows"
  | "ios"
  | "android";

interface PlatformHints {
  readonly userAgent: string;
  /** `navigator.userAgentData.platform`, which only Chromium provides. */
  readonly clientHintPlatform?: string;
  readonly maxTouchPoints: number;
}

const CLIENT_HINT_PLATFORMS: Readonly<Record<string, DownloadPlatform>> = {
  Android: "android",
  iOS: "ios",
  macOS: "macos",
  Windows: "windows",
  Linux: "linux",
};

/**
 * The client hint wins when present: Chromium's "request desktop site" sends
 * a desktop user agent but keeps the real platform there. Otherwise the user
 * agent decides, testing the tokens other platforms embed first: Android's
 * includes "Linux", and iOS's includes "like Mac OS X".
 */
function detectDownloadPlatform(hints: PlatformHints): DownloadPlatform | null {
  const hint = hints.clientHintPlatform;
  if (hint && Object.hasOwn(CLIENT_HINT_PLATFORMS, hint)) {
    return CLIENT_HINT_PLATFORMS[hint] ?? null;
  }
  const { userAgent } = hints;
  if (/Android/.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  // iPadOS browsers send a Mac user agent by default; Macs have no touch.
  if (/Macintosh/.test(userAgent)) {
    return hints.maxTouchPoints > 1 ? "ios" : "macos";
  }
  if (/Windows/.test(userAgent)) return "windows";
  // ChromeOS sends X11 too, and no row is built for it.
  if (/CrOS/.test(userAgent)) return null;
  if (/Linux|X11/.test(userAgent)) return "linux";
  return null;
}

type VisitorNavigator = Pick<Navigator, "maxTouchPoints" | "userAgent">;

function clientHintPlatform(navigator: VisitorNavigator): string | undefined {
  if (!("userAgentData" in navigator)) return undefined;
  const data = navigator.userAgentData;
  return typeof data === "object" &&
    data !== null &&
    "platform" in data &&
    typeof data.platform === "string"
    ? data.platform
    : undefined;
}

/** Moves the visitor's `[data-download-platform]` row first in its list. */
export function promoteVisitorDownload(
  document: Document,
  navigator: VisitorNavigator,
): void {
  const platform = detectDownloadPlatform({
    userAgent: navigator.userAgent,
    clientHintPlatform: clientHintPlatform(navigator),
    maxTouchPoints: navigator.maxTouchPoints,
  });
  if (!platform) return;
  const row = document.querySelector(`[data-download-platform="${platform}"]`);
  row?.parentElement?.prepend(row);
}

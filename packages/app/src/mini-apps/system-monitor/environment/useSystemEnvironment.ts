import { useMemo } from "react";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import { useOptionalTheme } from "../../../theme/ThemeProvider";
import {
  applyHighEntropyHints,
  formatIdentity,
  parseBrowserFromUserAgent,
  parseOsFromUserAgent,
  UNKNOWN_ENVIRONMENT_VALUE,
} from "./environment";
import {
  readCpuCores,
  readDeviceMemory,
  readDevicePixelRatio,
  readLanguage,
  readScreenLabel,
  readTimeZone,
  readTouchSupport,
  readUserAgent,
  useHighEntropyHints,
  useNativeBuildNumber,
  useOsColorScheme,
  useReducedMotion,
  useStorageEstimateLabel,
  useViewportLabel,
} from "./environmentSources";

export interface EnvironmentRow {
  readonly label: string;
  readonly value: string;
}

export const ENVIRONMENT_LABELS = {
  browser: "Browser",
  os: "OS",
  platform: "Platform",
  appVersion: "App Version",
  buildNumber: "Build Number",
  buildCommit: "Build Commit",
  apiUrl: "API URL",
  wsUrl: "WebSocket URL",
  appTheme: "App Theme",
  osColorScheme: "OS Color Scheme",
  reducedMotion: "Reduced Motion",
  viewport: "Viewport",
  screen: "Screen",
  pixelRatio: "Pixel Ratio",
  language: "Language",
  timeZone: "Time Zone",
  cpuCores: "CPU Cores",
  deviceMemory: "Device Memory",
  touch: "Touch",
  storage: "Storage",
  userAgent: "User Agent",
} as const;

/**
 * The Environment tab's contents as an ordered list of rows.
 *
 * Rows rather than a shaped object so the table and the support report render
 * from one definition: a field added here appears in both, in the same order,
 * with the same label, and neither can silently omit what the other shows.
 */
export function useSystemEnvironment(): ReadonlyArray<EnvironmentRow> {
  const hostConfig = useAppHostConfig();
  const theme = useOptionalTheme();
  const osColorScheme = useOsColorScheme();
  const reducedMotion = useReducedMotion();
  const viewport = useViewportLabel();
  const storage = useStorageEstimateLabel();
  const buildNumber = useNativeBuildNumber(hostConfig.readNativeBuildNumber);
  const highEntropyHints = useHighEntropyHints();

  const buildInfo = hostConfig.buildInfo;
  const { apiBaseUrl, wsUrl } = hostConfig;
  const activeTheme = theme?.activeTheme;
  const { platformVersion } = highEntropyHints;

  return useMemo(() => {
    const userAgent = readUserAgent();
    const browser = parseBrowserFromUserAgent(userAgent);
    const os = applyHighEntropyHints(parseOsFromUserAgent(userAgent), {
      platformVersion,
    });

    return [
      { label: ENVIRONMENT_LABELS.browser, value: formatIdentity(browser) },
      { label: ENVIRONMENT_LABELS.os, value: formatIdentity(os) },
      {
        label: ENVIRONMENT_LABELS.platform,
        value: buildInfo?.target ?? UNKNOWN_ENVIRONMENT_VALUE,
      },
      {
        label: ENVIRONMENT_LABELS.appVersion,
        value: buildInfo?.version ?? UNKNOWN_ENVIRONMENT_VALUE,
      },
      // The native build number (Android versionCode / iOS CFBundleVersion),
      // distinct from App Version above: fastlane bumps it per store upload while
      // the marketing version holds steady, so it is what pins a bug report to an
      // exact build. Only the native shells can read it; elsewhere it is unknown.
      { label: ENVIRONMENT_LABELS.buildNumber, value: buildNumber },
      {
        label: ENVIRONMENT_LABELS.buildCommit,
        value: buildInfo?.commit ?? UNKNOWN_ENVIRONMENT_VALUE,
      },
      // The backend endpoints the shell was built to reach. Both are inlined at
      // build time (VITE_API_BASE_URL and friends), so a release built without
      // them silently falls back to the localhost dev default — which on a
      // device is the phone itself, so every request and the events socket fail
      // and the app reads as offline. Surfacing them turns that misconfiguration
      // from an invisible failure into a one-glance diagnosis.
      { label: ENVIRONMENT_LABELS.apiUrl, value: apiBaseUrl },
      { label: ENVIRONMENT_LABELS.wsUrl, value: wsUrl },
      // The app's own theme and the OS preference are reported separately
      // because they disagree routinely — the app theme is a stored user choice,
      // not a mirror of the OS — and "the app is dark but the OS is light" is
      // exactly the kind of thing a screenshot-less bug report hides.
      {
        label: ENVIRONMENT_LABELS.appTheme,
        value: activeTheme ?? UNKNOWN_ENVIRONMENT_VALUE,
      },
      { label: ENVIRONMENT_LABELS.osColorScheme, value: osColorScheme },
      { label: ENVIRONMENT_LABELS.reducedMotion, value: reducedMotion },
      { label: ENVIRONMENT_LABELS.viewport, value: viewport },
      { label: ENVIRONMENT_LABELS.screen, value: readScreenLabel() },
      { label: ENVIRONMENT_LABELS.pixelRatio, value: readDevicePixelRatio() },
      { label: ENVIRONMENT_LABELS.language, value: readLanguage() },
      { label: ENVIRONMENT_LABELS.timeZone, value: readTimeZone() },
      { label: ENVIRONMENT_LABELS.cpuCores, value: readCpuCores() },
      { label: ENVIRONMENT_LABELS.deviceMemory, value: readDeviceMemory() },
      { label: ENVIRONMENT_LABELS.touch, value: readTouchSupport() },
      { label: ENVIRONMENT_LABELS.storage, value: storage },
      // Last, and always present: every field above it is a guess derived from
      // this string, so support needs it to check the guesses.
      { label: ENVIRONMENT_LABELS.userAgent, value: userAgent },
    ];
  }, [
    activeTheme,
    apiBaseUrl,
    buildInfo,
    buildNumber,
    osColorScheme,
    platformVersion,
    reducedMotion,
    storage,
    viewport,
    wsUrl,
  ]);
}

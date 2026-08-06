import { useCallback, useEffect, useState } from "react";
import type { ReadNativeBuildNumberFn } from "../../../host/AppHostConfig";
import { useTearleadsExternalValue } from "../../../providers/sdk/useTearleadsSubscription";
import { formatByteSize } from "../../../utils/formatByteSize";
import { UNKNOWN_ENVIRONMENT_VALUE } from "./environment";

/**
 * Reads of the live browser environment for the System Monitor.
 *
 * The values that can change while the monitor is open — OS color scheme,
 * reduced motion, viewport — are subscriptions rather than one-shot reads, so
 * both the tab and a copied report describe the machine as it is at copy time
 * rather than as it was at mount.
 */

/**
 * Navigator APIs lib.dom does not declare yet.
 *
 * Declared rather than cast at the call site, so these reads stay free of type
 * assertions (see scripts/lintPackageAssertions.ts). It lives here, inside an
 * imported module, rather than in a standalone .d.ts: the deployment targets
 * compile this package's sources directly instead of through project
 * references, and a global .d.ts that nothing imports would only load in this
 * package's own tsconfig program — leaving app-web, app-capacitor, and
 * app-electrobun to fail on the very same file.
 */
declare global {
  /** User-Agent Client Hints returned by `getHighEntropyValues`. */
  interface NavigatorUAHighEntropyValues {
    readonly platformVersion?: string;
  }

  interface NavigatorUAData {
    getHighEntropyValues(
      hints: ReadonlyArray<string>,
    ): Promise<NavigatorUAHighEntropyValues>;
  }

  interface Navigator {
    /**
     * Approximate device RAM in GB. Chromium-only, and deliberately coarse: a
     * power of two, capped at 8.
     */
    readonly deviceMemory?: number;
    /**
     * Chromium-only. Carries the true OS version that Chromium freezes out of
     * the user-agent string.
     */
    readonly userAgentData?: NavigatorUAData;
  }
}

function safeMatchMedia(query: string): MediaQueryList | null {
  // Guarded rather than assumed: matchMedia is absent in the happy-dom test
  // environment and in non-browser shells.
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return null;
  }

  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

/** `null` when the query cannot be evaluated at all, which reports as unknown. */
function useMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQueryList = safeMatchMedia(query);
      if (!mediaQueryList) {
        return () => {};
      }

      mediaQueryList.addEventListener("change", onStoreChange);
      return () => {
        mediaQueryList.removeEventListener("change", onStoreChange);
      };
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => safeMatchMedia(query)?.matches ?? null,
    [query],
  );

  return useTearleadsExternalValue(subscribe, getSnapshot);
}

export function useOsColorScheme(): string {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const prefersLight = useMediaQuery("(prefers-color-scheme: light)");

  if (prefersDark === null) {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  if (prefersDark) {
    return "dark";
  }
  // Neither query matching means the OS expresses no preference, which is
  // distinct from actively preferring light.
  return prefersLight ? "light" : "no preference";
}

export function useReducedMotion(): string {
  const prefersReducedMotion = useMediaQuery(
    "(prefers-reduced-motion: reduce)",
  );
  if (prefersReducedMotion === null) {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  return prefersReducedMotion ? "reduce" : "no preference";
}

/**
 * Returns the viewport as a preformatted string rather than a `{width, height}`
 * object: useSyncExternalStore compares snapshots by identity, and a fresh
 * object every read would loop forever.
 */
export function useViewportLabel(): string {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === "undefined") {
      return () => {};
    }

    window.addEventListener("resize", onStoreChange);
    return () => {
      window.removeEventListener("resize", onStoreChange);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") {
      return UNKNOWN_ENVIRONMENT_VALUE;
    }
    return `${window.innerWidth} × ${window.innerHeight}`;
  }, []);

  return useTearleadsExternalValue(subscribe, getSnapshot);
}

export function useStorageEstimateLabel(): string {
  const [label, setLabel] = useState(UNKNOWN_ENVIRONMENT_VALUE);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      return;
    }

    let cancelled = false;
    navigator.storage
      .estimate()
      .then(({ quota, usage }) => {
        if (cancelled) {
          return;
        }
        if (usage === undefined || quota === undefined) {
          return;
        }
        setLabel(`${formatByteSize(usage)} of ${formatByteSize(quota)}`);
      })
      // A rejected estimate is not worth surfacing as an error; the row simply
      // stays unknown.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return label;
}

/**
 * The native app build number (Android `versionCode` / iOS `CFBundleVersion`),
 * read at runtime through the host config's reader. Native shells inject one;
 * elsewhere (web, electrobun, tests) there is no reader and the row stays
 * unknown. Async like the storage estimate — it resolves after mount and the
 * row updates in place — because the value comes from a native bridge call
 * rather than a value inlined into the bundle.
 */
export function useNativeBuildNumber(
  read: ReadNativeBuildNumberFn | undefined,
): string {
  const [buildNumber, setBuildNumber] = useState(UNKNOWN_ENVIRONMENT_VALUE);

  useEffect(() => {
    if (!read) {
      return;
    }

    let cancelled = false;
    read()
      .then((value) => {
        if (!cancelled) {
          setBuildNumber(value === "" ? UNKNOWN_ENVIRONMENT_VALUE : value);
        }
      })
      // A failed read is not worth surfacing as an error; the row stays unknown.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [read]);

  return buildNumber;
}

/**
 * User-Agent Client Hints, which carry the true OS version that Chromium
 * freezes out of the user-agent string. Empty on browsers without the API,
 * where the user-agent parse stands on its own.
 */
export function useHighEntropyHints(): NavigatorUAHighEntropyValues {
  const [hints, setHints] = useState<NavigatorUAHighEntropyValues>({});

  useEffect(() => {
    if (typeof navigator === "undefined") {
      return;
    }

    const { userAgentData } = navigator;
    if (!userAgentData) {
      return;
    }

    let cancelled = false;
    userAgentData
      .getHighEntropyValues(["platformVersion"])
      .then((resolved) => {
        if (!cancelled) {
          setHints(resolved);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return hints;
}

export function readUserAgent(): string {
  if (typeof navigator === "undefined") {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  return navigator.userAgent;
}

export function readLanguage(): string {
  if (typeof navigator === "undefined") {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  return navigator.language || UNKNOWN_ENVIRONMENT_VALUE;
}

export function readTimeZone(): string {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      UNKNOWN_ENVIRONMENT_VALUE
    );
  } catch {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
}

export function readCpuCores(): string {
  if (typeof navigator === "undefined") {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  const { hardwareConcurrency } = navigator;
  return hardwareConcurrency === undefined
    ? UNKNOWN_ENVIRONMENT_VALUE
    : String(hardwareConcurrency);
}

export function readDeviceMemory(): string {
  if (typeof navigator === "undefined") {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }

  const { deviceMemory } = navigator;
  return deviceMemory === undefined
    ? UNKNOWN_ENVIRONMENT_VALUE
    : `${deviceMemory} GB`;
}

export function readTouchSupport(): string {
  if (typeof navigator === "undefined") {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  const { maxTouchPoints } = navigator;
  if (maxTouchPoints === undefined) {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  return maxTouchPoints > 0 ? `yes (${maxTouchPoints} points)` : "no";
}

export function readScreenLabel(): string {
  if (typeof window === "undefined" || !window.screen) {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  const { width, height } = window.screen;
  return `${width} × ${height}`;
}

export function readDevicePixelRatio(): string {
  if (typeof window === "undefined") {
    return UNKNOWN_ENVIRONMENT_VALUE;
  }
  return String(window.devicePixelRatio);
}

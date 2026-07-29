type AppBuildTarget = "capacitor" | "electrobun" | "web";

/** Build identity stamped by each deployment target's own bundler. */
export interface AppBuildInfo {
  readonly commit: string;
  readonly target: AppBuildTarget;
  readonly version: string;
}

const UNKNOWN_BUILD_VALUE = "unknown";

/** Normalizes unset build-time values to a stable support-report sentinel. */
export function createAppBuildInfo(input: {
  readonly commit: string | undefined;
  readonly target: AppBuildTarget;
  readonly version: string | undefined;
}): AppBuildInfo {
  return {
    commit:
      input.commit === undefined || input.commit === ""
        ? UNKNOWN_BUILD_VALUE
        : input.commit,
    target: input.target,
    version:
      input.version === undefined || input.version === ""
        ? UNKNOWN_BUILD_VALUE
        : input.version,
  };
}

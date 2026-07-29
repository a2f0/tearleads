// Each deployment target uses a different bundler, so the shells stamp these
// values and pass them through the host config instead of app source reading a
// bundler-specific environment API.
type AppBuildTarget = "capacitor" | "electrobun" | "web";

/** Build identity stamped by each deployment target's own bundler. */
export interface AppBuildInfo {
  readonly commit: string;
  readonly target: AppBuildTarget;
  readonly version: string;
}

const UNKNOWN_BUILD_VALUE = "unknown";

/** Empty strings and absent defines share one stable support-report sentinel. */
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

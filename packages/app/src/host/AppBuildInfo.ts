// Each deployment target uses a different bundler, so the shells stamp these
// values and pass them through the host config instead of app source reading a
// bundler-specific environment API.
type AppBuildTarget = "capacitor" | "electrobun" | "web";

/** Build identity stamped by each deployment target's own bundler. */
export interface AppBuildInfo {
  readonly commit: string;
  readonly packageVersions: Readonly<Record<string, string>>;
  readonly target: AppBuildTarget;
  readonly version: string;
}

const UNKNOWN_BUILD_VALUE = "unknown";

function isPackageVersions(
  value: unknown,
): value is Readonly<Record<string, string>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((version) => typeof version === "string")
  );
}

function parsePackageVersions(json: string | undefined) {
  try {
    const value: unknown = JSON.parse(json ?? "{}");
    if (isPackageVersions(value)) return value;
  } catch {
    // Optional diagnostics must not prevent startup for malformed host metadata.
  }
  return {};
}

/** Empty strings and absent defines share one stable support-report sentinel. */
export function createAppBuildInfo(input: {
  readonly commit: string | undefined;
  readonly packageVersionsJson: string | undefined;
  readonly target: AppBuildTarget;
  readonly version: string | undefined;
}): AppBuildInfo {
  return {
    commit:
      input.commit === undefined || input.commit === ""
        ? UNKNOWN_BUILD_VALUE
        : input.commit,
    // Produced by the build-time manifest reader; absent in unbundled hosts.
    packageVersions: parsePackageVersions(input.packageVersionsJson),
    target: input.target,
    version:
      input.version === undefined || input.version === ""
        ? UNKNOWN_BUILD_VALUE
        : input.version,
  };
}

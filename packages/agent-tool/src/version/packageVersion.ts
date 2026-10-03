import {
  type ExecFileSyncOptionsWithStringEncoding,
  execFileSync,
} from "node:child_process";
import { posix } from "node:path";

/** Discover every committed workspace, including globbed and newly added ones. */
export function workspacePackages(rootDir: string): string[] {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: rootDir,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  const root: { workspaces?: string[] | { packages?: string[] } } = JSON.parse(
    execFileSync("git", ["show", "HEAD:package.json"], options),
  );
  const patterns = Array.isArray(root.workspaces)
    ? root.workspaces
    : root.workspaces?.packages;
  if (!patterns || patterns.some((pattern) => typeof pattern !== "string")) {
    throw new Error("package.json must declare workspace package paths.");
  }
  const globs = patterns.map((pattern) => new Bun.Glob(pattern));
  return execFileSync("git", ["ls-tree", "-rz", "--name-only", "HEAD"], options)
    .split("\0")
    .filter((file) => file.endsWith("/package.json"))
    .map((file) => posix.dirname(file))
    .filter((directory) => globs.some((glob) => glob.match(directory)))
    .sort();
}

export function manifestPath(packageDir: string): string {
  return `${packageDir}/package.json`;
}

export function isVersionedManifest(
  rootDir: string,
  filePath: string,
): boolean {
  return workspacePackages(rootDir).some(
    (packageDir) => manifestPath(packageDir) === filePath,
  );
}

type Semver = readonly [major: number, minor: number, patch: number];

function parseSemver(version: string): Semver {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (match === null) {
    throw new Error(`"${version}" is not a plain major.minor.patch version.`);
  }
  const parts: Semver = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!parts.every(Number.isSafeInteger)) {
    throw new Error(`"${version}" exceeds the safe integer version range.`);
  }
  return parts;
}

export function bumpPatch(version: string): string {
  const [major, minor, patch] = parseSemver(version);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Whether `version` is a deliberate major or minor release over `base`, which
 * the patch bump must not overwrite.
 */
export function isReleaseBump(version: string, base: string): boolean {
  const [major, minor] = parseSemver(version);
  const [baseMajor, baseMinor] = parseSemver(base);
  return major > baseMajor || (major === baseMajor && minor > baseMinor);
}

/** The top-level `version` of a package.json source. */
export function readVersion(manifest: string, initialVersion?: string): string {
  const parsed: unknown = JSON.parse(manifest);
  const version =
    typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, "version")
      : undefined;
  if (typeof version !== "string") {
    if (version === undefined && initialVersion !== undefined) {
      return initialVersion;
    }
    throw new Error("package.json has no string version.");
  }
  parseSemver(version);
  return version;
}

/**
 * The package.json source with its top-level `version` replaced, leaving every
 * other byte alone so the diff is the one line.
 */
export function withVersion(manifest: string, version: string): string {
  const current = readVersion(manifest).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const field = new RegExp(`("version"\\s*:\\s*")${current}(")`);
  const updated = manifest.replace(
    field,
    (_match, open: string, close: string) => `${open}${version}${close}`,
  );
  if (readVersion(updated) !== version) {
    throw new Error("could not rewrite the package.json version field.");
  }
  return updated;
}

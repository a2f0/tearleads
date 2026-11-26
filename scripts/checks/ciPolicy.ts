export function ciDiffRange(
  base: string | undefined,
  head: string | undefined,
) {
  if (!base || /^0+$/.test(base)) return undefined;
  if (!/^[a-f0-9]{40}$/.test(base) || !head || !/^[a-f0-9]{40}$/.test(head)) {
    throw new Error("CI diff requires full base and head commit SHAs.");
  }
  return `${base}...${head}`;
}

/** `bun.lock` on each side of the diff; missing means it could not be read. */
export interface CiLockfiles {
  base?: string | undefined;
  head?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutWorkspaceVersions(lockfile: string) {
  const parsed: unknown = Bun.JSONC.parse(lockfile);
  if (!isRecord(parsed)) throw new Error("bun.lock is not an object.");
  const { workspaces: entries } = parsed;
  if (!isRecord(entries)) throw new Error("bun.lock has no workspaces.");
  const workspaces = Object.entries(entries).map(([path, workspace]) => {
    if (!isRecord(workspace)) {
      throw new Error(`bun.lock workspace ${path} is not an object.`);
    }
    return [
      path,
      Object.fromEntries(
        Object.entries(workspace).filter(([key]) => key !== "version"),
      ),
    ];
  });
  return { ...parsed, workspaces: Object.fromEntries(workspaces) };
}

// A hand version bump rewrites the workspace `version` fields of bun.lock.
// Those fields change nothing any platform lane installs, so only a lockfile
// that differs elsewhere (dependencies, resolutions, integrity, the workspace
// set) exercises every lane. A lockfile that is missing or cannot be parsed
// counts as changed.
export function lockfileChangeIsCommon({ base, head }: CiLockfiles) {
  if (base === undefined || head === undefined) return true;
  try {
    return !Bun.deepEquals(
      withoutWorkspaceVersions(base),
      withoutWorkspaceVersions(head),
    );
  } catch {
    return true;
  }
}

export function ciScopes(
  paths: readonly string[],
  lockfiles: CiLockfiles = {},
) {
  const common = paths.some((path) =>
    path === "bun.lock"
      ? lockfileChangeIsCommon(lockfiles)
      : /^(\.github\/workflows\/|scripts\/checks\/ci|\.mise\.toml$|\.nvmrc$|mise\.lock$|package\.json$)/.test(
          path,
        ),
  );
  return {
    native:
      common ||
      paths.some(
        (path) =>
          /^(packages\/app-capacitor\/|assets\/brand\/)/.test(path) ||
          path === "agent-tool.json" ||
          path === "scripts/lib/buildBrandImages.sh" ||
          path === "scripts/lib/installDependencies.sh" ||
          path === "scripts/lib/checkRoot.ts" ||
          path === "scripts/testing/runVerifiedTurbo.ts" ||
          path === "scripts/checks/testNativePurchaseBridge.sh",
      ),
    proofs:
      common ||
      paths.includes("scripts/lib/checkRoot.ts") ||
      paths.some((path) =>
        /^(formal\/lean\/|scripts\/protocol\/(generateTransparencyVectors|leanTools)\.ts$)/.test(
          path,
        ),
      ),
    terraform:
      common ||
      paths.some((path) =>
        /^(terraform\/|\.tflint\.hcl$|scripts\/|packages\/[^/]+\/scripts\/|packages\/[^/]+\/wrangler[^/]*\.jsonc$)/.test(
          path,
        ),
      ),
  };
}

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

export function ciScopes(paths: readonly string[]) {
  const common = paths.some((path) =>
    /^(\.github\/workflows\/|scripts\/checks\/ci|\.mise\.toml$|bun\.lock$|package\.json$)/.test(
      path,
    ),
  );
  return {
    native:
      common || paths.some((path) => /^packages\/app-capacitor\//.test(path)),
    terraform:
      common ||
      paths.some((path) =>
        /^(terraform\/|ansible\/|\.tflint\.hcl$|scripts\/|packages\/[^/]+\/scripts\/)/.test(
          path,
        ),
      ),
  };
}

interface JobResult {
  readonly result: string;
  readonly outputs?: Readonly<Record<string, string>>;
}

// A skipped job is safe only when successful change detection explicitly says
// it is irrelevant. Failed/cancelled prerequisites must never turn the gate green.
export function assertCiSuccess(needs: Readonly<Record<string, JobResult>>) {
  const { changes } = needs;
  for (const job of [
    "changes",
    "lint",
    "build",
    "postgres-concurrency",
    "windows",
  ]) {
    if (needs[job]?.result !== "success") {
      throw new Error(
        `${job} did not succeed: ${needs[job]?.result ?? "missing"}`,
      );
    }
  }
  for (const job of ["native", "terraform"]) {
    const scope = changes?.outputs?.[job];
    if (scope !== "true" && scope !== "false") {
      throw new Error(`Missing or invalid change scope: ${job}`);
    }
    const expected = scope === "true" ? "success" : "skipped";
    if (needs[job]?.result !== expected) {
      throw new Error(
        `${job} must be ${expected}: ${needs[job]?.result ?? "missing"}`,
      );
    }
  }
}

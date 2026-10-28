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
    /^(\.github\/workflows\/|scripts\/checks\/ci|\.mise\.toml$|mise\.lock$|bun\.lock$|package\.json$)/.test(
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
          path === "scripts/checks/testNativePurchaseBridge.sh",
      ),
    proofs:
      common ||
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

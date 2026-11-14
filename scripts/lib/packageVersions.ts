import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface PackageManifest {
  name: string;
  version: string;
  workspaces?: string[];
}

/** Only names and versions enter client bundles, never other manifest fields. */
function readPackageVersions(root: string): Record<string, string> {
  const manifest: PackageManifest = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  );
  const manifests = [
    manifest,
    ...(manifest.workspaces ?? []).map(
      (workspace): PackageManifest =>
        JSON.parse(
          readFileSync(resolve(root, workspace, "package.json"), "utf8"),
        ),
    ),
  ];
  return Object.fromEntries(
    manifests.map(({ name, version }) => {
      if (!name || !version) throw new Error("Package name/version is missing");
      return [name, version];
    }),
  );
}

if (import.meta.main) {
  console.log(
    JSON.stringify(readPackageVersions(resolve(import.meta.dirname, "../.."))),
  );
}

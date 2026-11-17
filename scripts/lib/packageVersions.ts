import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface PackageManifest {
  name: string;
  version: string;
  workspaces?: string[];
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(resolve(path, "package.json"), "utf8"));
}

/**
 * Only names and versions enter client bundles, never other manifest fields.
 * The root manifest supplies the workspace list but is not reported: it is
 * private and unversioned, so its version would never identify a build.
 */
function readPackageVersions(root: string): Record<string, string> {
  const { workspaces = [] } = readManifest(root);
  return Object.fromEntries(
    workspaces.map((workspace) => {
      const { name, version } = readManifest(resolve(root, workspace));
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

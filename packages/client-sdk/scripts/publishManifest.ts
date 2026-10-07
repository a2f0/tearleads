import { readFileSync } from "node:fs";
import { join } from "node:path";
import { moduleSpecifiers, packageName } from "./packageOutput";

type ExportTarget = string | { default: string; types: string };

export interface WorkspaceManifest {
  dependencies?: Record<string, string>;
  exports: Record<string, ExportTarget>;
  name: string;
  version: string;
}

export interface Workspace {
  directory: string;
  manifest: WorkspaceManifest;
}

interface RootManifest {
  catalog: Record<string, string>;
  catalogs: Record<string, Record<string, string>>;
}

function readManifest<T>(directory: string): T {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

// The SDK and every workspace package it reaches through workspace:
// dependencies, keyed by package name.
export function collectWorkspaces(sdkDirectory: string) {
  const packagesDir = join(sdkDirectory, "..");
  const workspaces = new Map<string, Workspace>();
  const pending = ["@tearleads/client-sdk"];
  for (let name = pending.pop(); name; name = pending.pop()) {
    if (workspaces.has(name)) {
      continue;
    }
    // Each @tearleads/<name> lives in packages/<name>.
    const directory =
      name === "@tearleads/client-sdk"
        ? sdkDirectory
        : join(packagesDir, name.replace(/^@tearleads\//, ""));
    const manifest = readManifest<WorkspaceManifest>(directory);
    if (manifest.name !== name) {
      throw new Error(`${directory} holds ${manifest.name}, not ${name}`);
    }
    workspaces.set(name, { directory, manifest });
    for (const [dependency, range] of Object.entries(
      manifest.dependencies ?? {},
    )) {
      if (range.startsWith("workspace:")) {
        pending.push(dependency);
      }
    }
  }
  return workspaces;
}

function resolveCatalog(name: string, range: string, root: RootManifest) {
  if (!range.startsWith("catalog:")) {
    return range;
  }
  const catalog = range.slice("catalog:".length);
  const version = catalog ? root.catalogs[catalog]?.[name] : root.catalog[name];
  if (!version) {
    throw new Error(`${name} is missing from the ${range} catalog`);
  }
  return version;
}

// The version a bundled workspace declares for a package it imports at
// runtime. Bundled packages must agree, since the npm package has one copy.
function declaredVersion(
  name: string,
  workspaces: Map<string, Workspace>,
  root: RootManifest,
) {
  const versions = new Set(
    [...workspaces.values()].flatMap(({ manifest }) => {
      const range = manifest.dependencies?.[name];
      return range ? [resolveCatalog(name, range, root)] : [];
    }),
  );
  const [version, ...conflicts] = versions;
  if (!version) {
    throw new Error(`no bundled workspace declares a dependency on ${name}`);
  }
  if (conflicts.length > 0) {
    throw new Error(`bundled workspaces disagree on ${name}: ${[...versions]}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${name} needs an exact workspace version, not ${version}`);
  }
  return version;
}

// Every package the output imports outside itself, as a caret range consumers
// can dedupe against.
function externalDependencies(
  workspaces: Map<string, Workspace>,
  files: readonly { source: string }[],
  root: RootManifest,
) {
  const names = new Set(
    files.flatMap(({ source }) =>
      moduleSpecifiers(source)
        .filter((specifier) => !specifier.startsWith("."))
        .map(packageName),
    ),
  );
  return Object.fromEntries(
    [...names]
      .sort()
      .map((name) => [name, `^${declaredVersion(name, workspaces, root)}`]),
  );
}

// The SDK's subpath exports, pointed at the package root instead of dist/.
function publishedExports(manifest: WorkspaceManifest) {
  const fromRoot = (path: string) => path.replace(/^\.\/dist\//, "./");
  return Object.fromEntries(
    Object.entries(manifest.exports).map(([subpath, target]) => [
      subpath,
      typeof target === "string"
        ? fromRoot(target)
        : { types: fromRoot(target.types), default: fromRoot(target.default) },
    ]),
  );
}

export function publishManifest(
  workspaces: Map<string, Workspace>,
  files: readonly { source: string }[],
) {
  const sdk = workspaces.get("@tearleads/client-sdk");
  if (!sdk) {
    throw new Error("the client SDK manifest is missing");
  }
  const root = readManifest<RootManifest>(join(sdk.directory, "..", ".."));
  return {
    name: sdk.manifest.name,
    version: sdk.manifest.version,
    description:
      "React-free Tearleads client runtime: local SQLite persistence, keys, sync, encrypted blobs, and domain workflows.",
    license: "UNLICENSED",
    // npm rejects a provenance-signed publish unless this names the repository
    // the publishing workflow ran in.
    repository: {
      type: "git",
      url: "git+https://github.com/a2f0/tearleads.git",
      directory: "packages/client-sdk",
    },
    type: "module",
    main: "./index.js",
    types: "./index.d.ts",
    exports: publishedExports(sdk.manifest),
    sideEffects: false,
    dependencies: externalDependencies(workspaces, files, root),
  };
}

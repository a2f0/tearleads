import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import {
  listFiles,
  moduleSpecifierPattern,
  outputFiles,
  pruneUnreachableDeclarations,
} from "./packageOutput";
import {
  collectWorkspaces,
  publishManifest,
  type Workspace,
  type WorkspaceManifest,
} from "./publishManifest";

const packageRoot = join(import.meta.dir, "..");
const packagesDir = join(packageRoot, "..");
const repoRoot = join(packagesDir, "..");

// The workspace packages the SDK imports export TypeScript source and are not
// published, so the npm package carries each one compiled under
// internal/<directory>/, beside the SDK's own modules at the package root.
function outputDirectory(outDir: string, workspace: Workspace) {
  return workspace.directory === packageRoot
    ? outDir
    : join(outDir, "internal", basename(workspace.directory));
}

// Builds the package npm receives: the SDK and the workspace packages it
// imports, compiled together with declarations and source maps, the README,
// and a package.json written for consumers. The workspace keeps resolving
// dist/ from `bun run build`; nothing in the repo reads this output, so it can
// never go stale under another package's tests.
export async function buildPackage(outDir: string): Promise<void> {
  const workspaces = collectWorkspaces(packageRoot);
  const stageDir = await mkdtemp(join(tmpdir(), "client-sdk-package-"));
  try {
    await rm(outDir, { force: true, recursive: true });
    const compiledDir = join(stageDir, "compiled");
    await compile(workspaces, stageDir, compiledDir);
    for (const workspace of workspaces.values()) {
      const fromDir = join(compiledDir, basename(workspace.directory), "src");
      // A package the SDK imports only for types the output drops compiles
      // to nothing.
      if (existsSync(fromDir)) {
        await relocate(fromDir, outputDirectory(outDir, workspace));
      }
    }
    await rewriteWorkspaceSpecifiers(workspaces, outDir);
    run([
      process.execPath,
      join(repoRoot, "scripts", "lib", "rewriteDistImports.ts"),
      outDir,
    ]);
    await pruneUnreachableDeclarations(outDir, entryDeclarations(workspaces));
    await cp(join(packageRoot, "README.md"), join(outDir, "README.md"));
    const manifest = publishManifest(workspaces, await outputFiles(outDir));
    await writeFile(
      join(outDir, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } finally {
    await rm(stageDir, { force: true, recursive: true });
  }
}

function sourceExportTargets(manifest: WorkspaceManifest) {
  return Object.entries(manifest.exports).flatMap(([subpath, target]) =>
    typeof target === "string" && /^\.\/src\/.+\.ts$/.test(target)
      ? [{ specifier: `${manifest.name}${subpath.slice(1)}`, target }]
      : [],
  );
}

// Maps each source export of a bundled package to its .ts file, so tsc
// compiles it with the SDK instead of treating it as an external library.
function compilerPaths(workspaces: Map<string, Workspace>) {
  const paths: Record<string, string[]> = {};
  for (const { directory, manifest } of workspaces.values()) {
    for (const { specifier, target } of sourceExportTargets(manifest)) {
      paths[specifier] = [join(directory, target)];
    }
  }
  return paths;
}

function sdkWorkspace(workspaces: Map<string, Workspace>) {
  const sdk = workspaces.get("@tearleads/client-sdk");
  if (!sdk) {
    throw new Error("the client SDK manifest is missing");
  }
  return sdk;
}

function conditionalExports(manifest: WorkspaceManifest) {
  return Object.values(manifest.exports).map((target) => {
    if (typeof target === "string") {
      throw new Error(`expected a conditional export, not ${target}`);
    }
    return target;
  });
}

// The SDK's own entry points, from the dist paths its manifest exports.
function entrySources(workspaces: Map<string, Workspace>) {
  return conditionalExports(sdkWorkspace(workspaces).manifest).map((target) =>
    join(
      packageRoot,
      target.default.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts"),
    ),
  );
}

// The declarations those entry points publish, relative to the output.
function entryDeclarations(workspaces: Map<string, Workspace>) {
  return conditionalExports(sdkWorkspace(workspaces).manifest).map((target) =>
    target.types.replace(/^\.\/dist\//, ""),
  );
}

function run(command: string[]) {
  const [executable, ...args] = command;
  if (!executable) {
    throw new Error("empty command");
  }
  const result = spawnSync(executable, args, {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} exited with ${result.status}`);
  }
}

// Compiles from the SDK's entry points, so only modules they reach are
// emitted, under the SDK's compiler options.
async function compile(
  workspaces: Map<string, Workspace>,
  stageDir: string,
  compiledDir: string,
) {
  const tsconfig = join(stageDir, "tsconfig.json");
  await writeFile(
    tsconfig,
    JSON.stringify({
      extends: join(packageRoot, "tsconfig.json"),
      compilerOptions: {
        composite: false,
        declaration: true,
        incremental: false,
        inlineSources: true,
        noEmit: false,
        outDir: compiledDir,
        paths: compilerPaths(workspaces),
        rootDir: packagesDir,
        sourceMap: true,
        // The config is written outside the workspace, so name the type
        // roots tsc would otherwise find by walking up from it.
        typeRoots: [join(repoRoot, "node_modules", "@types")],
        types: ["bun"],
      },
      files: entrySources(workspaces),
      include: [],
    }),
  );
  run([process.execPath, "x", "tsc", "-p", tsconfig]);
}

// Moves one package's compiled tree into place. Each source map names its
// source by file name alone (the source travels inline), so no map records
// where the package was built.
async function relocate(fromDir: string, toDir: string) {
  for (const file of await listFiles(fromDir)) {
    const target = join(toDir, file);
    await mkdir(dirname(target), { recursive: true });
    const contents = await readFile(join(fromDir, file), "utf8");
    if (!file.endsWith(".map")) {
      await writeFile(target, contents);
      continue;
    }
    const map: { sources: string[] } = JSON.parse(contents);
    map.sources = map.sources.map((source) => basename(source));
    await writeFile(target, JSON.stringify(map));
  }
}

// Where each bundled package's source exports land in the output.
function specifierTargets(workspaces: Map<string, Workspace>, outDir: string) {
  const targets = new Map<string, string>();
  for (const workspace of workspaces.values()) {
    const directory = outputDirectory(outDir, workspace);
    for (const { specifier, target } of sourceExportTargets(
      workspace.manifest,
    )) {
      targets.set(
        specifier,
        join(directory, target.replace(/^\.\/src\/(.+)\.ts$/, "$1.js")),
      );
    }
  }
  return targets;
}

// Points every import of a bundled package at its copy in the output.
async function rewriteWorkspaceSpecifiers(
  workspaces: Map<string, Workspace>,
  outDir: string,
) {
  const targets = specifierTargets(workspaces, outDir);
  for (const { file, source } of await outputFiles(outDir)) {
    const rewritten = source.replace(
      moduleSpecifierPattern,
      (statement, prefix: string, quote: string, specifier: string) => {
        if (!specifier.startsWith("@tearleads/")) {
          return statement;
        }
        const target = targets.get(specifier);
        if (!target) {
          throw new Error(`${file} imports unbundled ${specifier}`);
        }
        const path = relative(dirname(join(outDir, file)), target);
        return `${prefix}${quote}${path.startsWith(".") ? path : `./${path}`}${quote}`;
      },
    );
    if (rewritten !== source) {
      await writeFile(join(outDir, file), rewritten);
    }
  }
}

// The output directory is required: the default dist/ is the workspace build.
if (import.meta.main) {
  const outDir = process.argv[2];
  if (!outDir) {
    throw new Error("usage: bun scripts/buildPackage.ts <out-dir>");
  }
  await buildPackage(outDir);
  console.log(`Built ${outDir}`);
}

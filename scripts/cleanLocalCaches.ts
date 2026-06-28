#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { lstat, readdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface CliOptions {
  readonly dryRun: boolean;
  readonly includeNodeModules: boolean;
}

interface CleanupTarget {
  readonly path: string;
  readonly reason: string;
}

interface SizedCleanupTarget extends CleanupTarget {
  readonly bytes: number;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const formatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

const ignoredTraversalDirs = new Set([
  ".git",
  ".secrets",
  ".test_files",
  "node_modules",
]);

const rebuildableDirReasons = new Map([
  [".astro", "Astro build cache"],
  [".turbo", "Turbo task cache"],
  [".terraform", "Terraform provider/module cache"],
  ["coverage", "test coverage output"],
  ["playwright-report", "Playwright report output"],
  ["target", "Rust build output"],
  ["test-results", "Playwright test results"],
]);

const explicitTargets: CleanupTarget[] = [
  { path: ".turbo", reason: "Turbo task cache" },
  { path: "target", reason: "Rust build output" },
  { path: "playwright-report", reason: "Playwright report output" },
  { path: "test-results", reason: "Playwright test results" },
  { path: "coverage", reason: "test coverage output" },
  {
    path: "packages/app-electrobun/node_modules/.electrobun-cache",
    reason: "Electrobun package-local native runtime cache",
  },
  { path: "node_modules/.cache", reason: "package-manager tool cache" },
];

function printUsage(): never {
  console.error(
    [
      "Usage: bun scripts/cleanLocalCaches.ts [--dry-run] [--include-node-modules]",
      "",
      "Removes checkout-local caches and generated outputs that can be rebuilt.",
      "The default keeps node_modules so the checkout remains immediately usable.",
      "",
      "Options:",
      "  --dry-run               Show what would be removed without deleting it.",
      "  --include-node-modules  Also remove root and workspace node_modules.",
      "  --help                  Show this help.",
    ].join("\n"),
  );
  process.exit(2);
}

function parseCliOptions(args: readonly string[]): CliOptions {
  let dryRun = false;
  let includeNodeModules = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--include-node-modules") {
      includeNodeModules = true;
      continue;
    }

    if (arg === "--help") {
      printUsage();
    }

    console.error(`Unknown option: ${arg}`);
    printUsage();
  }

  return { dryRun, includeNodeModules };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function toRootRelativePath(path: string): string {
  return relative(rootDir, path).replaceAll("\\", "/");
}

function resolveCheckoutPath(path: string): string {
  const resolvedPath = resolve(rootDir, path);
  if (
    resolvedPath === rootDir ||
    !resolvedPath.startsWith(`${rootDir}${sep}`)
  ) {
    throw new Error(`Refusing to clean path outside checkout: ${path}`);
  }

  return resolvedPath;
}

function parentPathContainsTarget(
  path: string,
  targetPaths: ReadonlyMap<string, unknown>,
): boolean {
  let currentPath = dirname(path);

  while (currentPath !== rootDir && currentPath !== dirname(currentPath)) {
    if (targetPaths.has(currentPath)) {
      return true;
    }

    currentPath = dirname(currentPath);
  }

  return false;
}

function isTsBuildInfo(path: string): boolean {
  return path.endsWith(".tsbuildinfo");
}

async function addTarget(
  targets: Map<string, CleanupTarget>,
  target: CleanupTarget,
): Promise<void> {
  const resolvedPath = resolveCheckoutPath(target.path);
  if (!(await pathExists(resolvedPath))) {
    return;
  }

  targets.set(resolvedPath, {
    path: resolvedPath,
    reason: target.reason,
  });
}

async function collectGeneratedTargets(
  currentDir: string,
  targets: Map<string, CleanupTarget>,
): Promise<void> {
  if (parentPathContainsTarget(currentDir, targets)) {
    return;
  }

  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (ignoredTraversalDirs.has(entry.name)) {
        continue;
      }

      const reason = rebuildableDirReasons.get(entry.name);
      if (reason) {
        targets.set(entryPath, { path: entryPath, reason });
        continue;
      }

      await collectGeneratedTargets(entryPath, targets);
      continue;
    }

    if (entry.isFile() && isTsBuildInfo(entry.name)) {
      targets.set(entryPath, {
        path: entryPath,
        reason: "TypeScript incremental build info",
      });
    }
  }
}

async function collectNodeModuleCacheTargets(
  targets: Map<string, CleanupTarget>,
): Promise<void> {
  await addTarget(targets, {
    path: "node_modules/.cache",
    reason: "package-manager tool cache",
  });

  const packagesDir = resolveCheckoutPath("packages");
  if (!(await pathExists(packagesDir))) {
    return;
  }

  const packageDirs = await readdir(packagesDir, { withFileTypes: true });
  for (const packageDir of packageDirs) {
    if (!packageDir.isDirectory()) {
      continue;
    }

    const packagePath = `packages/${packageDir.name}`;
    for (const cacheName of [".cache", ".electrobun-cache", ".vite"]) {
      await addTarget(targets, {
        path: `${packagePath}/node_modules/${cacheName}`,
        reason: `workspace node_modules ${cacheName} cache`,
      });
    }
  }
}

async function collectNodeModuleTargets(
  targets: Map<string, CleanupTarget>,
): Promise<void> {
  await addTarget(targets, {
    path: "node_modules",
    reason: "root dependency install",
  });

  const packagesDir = resolveCheckoutPath("packages");
  if (!(await pathExists(packagesDir))) {
    return;
  }

  const packageDirs = await readdir(packagesDir, { withFileTypes: true });
  for (const packageDir of packageDirs) {
    if (!packageDir.isDirectory()) {
      continue;
    }

    await addTarget(targets, {
      path: `packages/${packageDir.name}/node_modules`,
      reason: "workspace dependency install",
    });
  }
}

async function collectCleanupTargets(
  options: CliOptions,
): Promise<CleanupTarget[]> {
  const targets = new Map<string, CleanupTarget>();

  for (const target of explicitTargets) {
    await addTarget(targets, target);
  }

  await collectGeneratedTargets(rootDir, targets);
  await collectNodeModuleCacheTargets(targets);

  if (options.includeNodeModules) {
    await collectNodeModuleTargets(targets);
  }

  return Array.from(targets.values()).filter(
    (target) => !parentPathContainsTarget(target.path, targets),
  );
}

function measurePathBytes(path: string): number {
  const result = spawnSync("du", ["-sk", path], {
    encoding: "utf8",
    maxBuffer: 1_024 * 1_024,
  });

  if (result.status !== 0) {
    return 0;
  }

  const sizeText = result.stdout.split(/\s+/u)[0] ?? "0";
  const kib = Number.parseInt(sizeText, 10);
  return Number.isFinite(kib) ? kib * 1_024 : 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1_024;
  let unitIndex = 0;

  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }

  return `${formatter.format(value)} ${units[unitIndex]}`;
}

async function removeTarget(target: SizedCleanupTarget): Promise<void> {
  await rm(target.path, { force: true, recursive: true });
}

function printTargets(targets: readonly SizedCleanupTarget[]): void {
  const sortedTargets = [...targets].sort(
    (left, right) => right.bytes - left.bytes,
  );

  for (const target of sortedTargets) {
    console.log(
      `${formatBytes(target.bytes).padStart(10)}  ${toRootRelativePath(target.path)}  (${target.reason})`,
    );
  }
}

const options = parseCliOptions(process.argv.slice(2));
const targets = await collectCleanupTargets(options);
const sizedTargets = targets.map((target) => ({
  ...target,
  bytes: measurePathBytes(target.path),
}));
const totalBytes = sizedTargets.reduce(
  (total, target) => total + target.bytes,
  0,
);

if (sizedTargets.length === 0) {
  console.log("No checkout-local caches or generated outputs found.");
  process.exit(0);
}

console.log(
  `${options.dryRun ? "Would remove" : "Removing"} ${sizedTargets.length} checkout-local targets (${formatBytes(totalBytes)}):`,
);
printTargets(sizedTargets);

if (options.dryRun) {
  process.exit(0);
}

for (const target of sizedTargets) {
  await removeTarget(target);
}

console.log(
  `Removed ${formatBytes(totalBytes)} from checkout-local caches and generated outputs.`,
);

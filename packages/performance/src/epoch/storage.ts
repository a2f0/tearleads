import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  formatEpochTrendsMarkdown,
  formatResultsIndexMarkdown,
} from "./markdown";
import {
  CURRENT_EPOCH,
  EPOCH_SCHEMA_VERSION,
  type EpochManifest,
  type EpochSnapshot,
} from "./schema";

export function epochDir(resultsDir: string): string {
  return join(resultsDir, `epoch-${CURRENT_EPOCH}`);
}

function manifestPath(resultsDir: string): string {
  return join(epochDir(resultsDir), "manifest.json");
}

function defaultManifest(now: string): EpochManifest {
  return {
    schemaVersion: EPOCH_SCHEMA_VERSION,
    epoch: CURRENT_EPOCH,
    title: "Greenfield Protocol, Database & Realtime Optimization Pass",
    startedAt: now,
    description:
      "Structured longitudinal performance snapshots capturing schema, wire, API DB, client SQLite, query plan, multi-party scenario, and scaling probe metrics across greenfield optimization PRs.",
    entries: [],
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isValidKind(kind: unknown): boolean {
  return kind === "baseline" || kind === "checkpoint" || kind === "final";
}

function assertManifestEntry(value: unknown, path: string, idx: number): void {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} entries[${idx}] must be an object.`);
  }
  const issues = Reflect.get(value, "issues");
  const seq = Reflect.get(value, "seq");
  if (
    typeof Reflect.get(value, "id") !== "string" ||
    typeof seq !== "number" ||
    !Number.isFinite(seq) ||
    typeof Reflect.get(value, "label") !== "string" ||
    !isValidKind(Reflect.get(value, "kind")) ||
    typeof Reflect.get(value, "recordedAt") !== "string" ||
    typeof Reflect.get(value, "revision") !== "string" ||
    typeof Reflect.get(value, "dirty") !== "boolean" ||
    !Array.isArray(issues) ||
    !issues.every((n) => typeof n === "number") ||
    typeof Reflect.get(value, "snapshotFile") !== "string"
  ) {
    throw new Error(`${path} entries[${idx}] is not a valid manifest entry.`);
  }
}

function assertEpochManifest(
  value: unknown,
  path: string,
): asserts value is EpochManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} is not a valid Epoch ${CURRENT_EPOCH} manifest.`);
  }
  const entries = Reflect.get(value, "entries");
  if (
    Reflect.get(value, "schemaVersion") !== EPOCH_SCHEMA_VERSION ||
    Reflect.get(value, "epoch") !== CURRENT_EPOCH ||
    typeof Reflect.get(value, "title") !== "string" ||
    typeof Reflect.get(value, "startedAt") !== "string" ||
    typeof Reflect.get(value, "description") !== "string" ||
    !Array.isArray(entries)
  ) {
    throw new Error(`${path} is not a valid Epoch ${CURRENT_EPOCH} manifest.`);
  }
  for (const [idx, entry] of entries.entries()) {
    assertManifestEntry(entry, path, idx);
  }
}

export async function loadManifest(resultsDir: string): Promise<EpochManifest> {
  const path = manifestPath(resultsDir);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return defaultManifest(new Date().toISOString());
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  assertEpochManifest(parsed, path);
  return parsed;
}

function isValidOptionalSections(value: object): boolean {
  const objKeys = ["inventory", "canaries", "scenarios", "plans"];
  const arrKeys = ["reload", "realtime", "rotations", "baselines"];
  for (const key of objKeys) {
    const field = Reflect.get(value, key);
    if (
      field !== undefined &&
      (typeof field !== "object" || field === null || Array.isArray(field))
    ) {
      return false;
    }
  }
  for (const key of arrKeys) {
    const field = Reflect.get(value, key);
    if (field !== undefined && !Array.isArray(field)) return false;
  }
  return true;
}

function isValidRuntime(runtime: unknown): boolean {
  if (typeof runtime !== "object" || runtime === null) return false;
  const cpu = Reflect.get(runtime, "cpu");
  return (
    typeof Reflect.get(runtime, "bun") === "string" &&
    typeof Reflect.get(runtime, "platform") === "string" &&
    typeof Reflect.get(runtime, "arch") === "string" &&
    (cpu === null || typeof cpu === "string")
  );
}

function assertEpochSnapshot(
  value: unknown,
  path: string,
): asserts value is EpochSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} is not a valid Epoch ${CURRENT_EPOCH} snapshot.`);
  }
  const issues = Reflect.get(value, "issues");
  if (
    Reflect.get(value, "schemaVersion") !== EPOCH_SCHEMA_VERSION ||
    Reflect.get(value, "epoch") !== CURRENT_EPOCH ||
    typeof Reflect.get(value, "id") !== "string" ||
    typeof Reflect.get(value, "label") !== "string" ||
    typeof Reflect.get(value, "recordedAt") !== "string" ||
    typeof Reflect.get(value, "revision") !== "string" ||
    typeof Reflect.get(value, "dirty") !== "boolean" ||
    !isValidKind(Reflect.get(value, "kind")) ||
    !Array.isArray(issues) ||
    !issues.every((n) => typeof n === "number") ||
    !isValidRuntime(Reflect.get(value, "runtime")) ||
    !isValidOptionalSections(value)
  ) {
    throw new Error(`${path} is not a valid Epoch ${CURRENT_EPOCH} snapshot.`);
  }
}

function resolveConfinedSnapshotPath(
  dir: string,
  snapshotFile: string,
): string {
  const resolvedDir = resolve(dir);
  const resolvedPath = resolve(resolvedDir, snapshotFile);
  const rel = relative(resolvedDir, resolvedPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Snapshot path '${snapshotFile}' escapes ${resolvedDir}.`);
  }
  return resolvedPath;
}

export async function loadAllSnapshots(
  resultsDir: string,
  manifest: EpochManifest,
): Promise<EpochSnapshot[]> {
  const dir = epochDir(resultsDir);
  return Promise.all(
    manifest.entries.map(async (entry) => {
      const path = resolveConfinedSnapshotPath(dir, entry.snapshotFile);
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      assertEpochSnapshot(parsed, path);
      if (parsed.id !== entry.id) {
        throw new Error(
          `Snapshot ${path} id '${parsed.id}' does not match manifest entry '${entry.id}'.`,
        );
      }
      return parsed;
    }),
  );
}

export async function writeEpochViews(
  resultsDir: string,
  manifest: EpochManifest,
  snapshots: readonly EpochSnapshot[],
): Promise<void> {
  const dir = epochDir(resultsDir);
  await mkdir(join(dir, "snapshots"), { recursive: true });
  await writeFile(
    manifestPath(resultsDir),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(dir, "TRENDS.md"),
    formatEpochTrendsMarkdown(manifest, snapshots),
    "utf8",
  );
  await writeFile(
    join(resultsDir, "README.md"),
    formatResultsIndexMarkdown(manifest, snapshots),
    "utf8",
  );
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  formatEpochTrendsMarkdown,
  formatResultsIndexMarkdown,
} from "./markdown";
import {
  CURRENT_EPOCH,
  EPOCH_SCHEMA_VERSION,
  type EpochEntryKind,
  type EpochManifest,
  type EpochManifestEntry,
  type EpochRuntimeInfo,
  type EpochSnapshot,
} from "./schema";
import {
  requireArray,
  requireBoolean,
  requireFiniteNumber,
  requireNullableString,
  requireNumberArray,
  requireObject,
  requireOptionalPositiveInt,
  requireOptionalString,
  requireString,
} from "./validate";
import {
  parseBaselinesSection,
  parseCanariesSection,
  parseInventorySection,
  parsePlansSection,
  parseRealtimeSection,
  parseReloadSection,
  parseRotationsSection,
  parseScenariosSection,
} from "./validateSnapshot";

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

function requireKind(
  record: Record<string, unknown>,
  path: string,
): EpochEntryKind {
  const kind = requireString(record, "kind", path);
  if (kind !== "baseline" && kind !== "checkpoint" && kind !== "final") {
    throw new Error(`${path} has invalid kind '${kind}'.`);
  }
  return kind;
}

function parseManifestEntry(
  raw: unknown,
  path: string,
  idx: number,
): EpochManifestEntry {
  const entry = requireObject(raw, `${path} entries[${idx}]`);
  const pr = requireOptionalPositiveInt(entry, "pr", path);
  const notes = requireOptionalString(entry, "notes", path);
  return {
    id: requireString(entry, "id", path),
    seq: requireFiniteNumber(entry, "seq", path),
    label: requireString(entry, "label", path),
    kind: requireKind(entry, path),
    recordedAt: requireString(entry, "recordedAt", path),
    revision: requireString(entry, "revision", path),
    dirty: requireBoolean(entry, "dirty", path),
    ...(pr !== undefined ? { pr } : {}),
    issues: requireNumberArray(entry, "issues", path),
    snapshotFile: requireString(entry, "snapshotFile", path),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function parseEpochManifest(raw: unknown, path: string): EpochManifest {
  const obj = requireObject(raw, path);
  if (
    Reflect.get(obj, "schemaVersion") !== EPOCH_SCHEMA_VERSION ||
    Reflect.get(obj, "epoch") !== CURRENT_EPOCH
  ) {
    throw new Error(`${path} is not a valid Epoch ${CURRENT_EPOCH} manifest.`);
  }
  const entries = requireArray(obj, "entries", path).map((entry, idx) =>
    parseManifestEntry(entry, path, idx),
  );
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new Error(
        `${path} contains duplicate manifest entry id '${entry.id}'.`,
      );
    }
    seenIds.add(entry.id);
  }
  return {
    schemaVersion: EPOCH_SCHEMA_VERSION,
    epoch: CURRENT_EPOCH,
    title: requireString(obj, "title", path),
    startedAt: requireString(obj, "startedAt", path),
    description: requireString(obj, "description", path),
    entries,
  };
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
  return parseEpochManifest(JSON.parse(raw), path);
}

function parseRuntime(raw: unknown, path: string): EpochRuntimeInfo {
  const runtime = requireObject(raw, `${path} runtime`);
  return {
    bun: requireString(runtime, "bun", path),
    platform: requireString(runtime, "platform", path),
    arch: requireString(runtime, "arch", path),
    cpu: requireNullableString(runtime, "cpu", path),
  };
}

function parseOptionalSections(
  obj: Record<string, unknown>,
  path: string,
): Pick<
  EpochSnapshot,
  | "inventory"
  | "canaries"
  | "scenarios"
  | "plans"
  | "reload"
  | "realtime"
  | "rotations"
  | "baselines"
> {
  const inventory = Reflect.get(obj, "inventory");
  const canaries = Reflect.get(obj, "canaries");
  const scenarios = Reflect.get(obj, "scenarios");
  const plans = Reflect.get(obj, "plans");
  const reload = Reflect.get(obj, "reload");
  const realtime = Reflect.get(obj, "realtime");
  const rotations = Reflect.get(obj, "rotations");
  const baselines = Reflect.get(obj, "baselines");
  return {
    ...(inventory !== undefined
      ? { inventory: parseInventorySection(inventory, path) }
      : {}),
    ...(canaries !== undefined
      ? { canaries: parseCanariesSection(canaries, path) }
      : {}),
    ...(scenarios !== undefined
      ? { scenarios: parseScenariosSection(scenarios, path) }
      : {}),
    ...(plans !== undefined ? { plans: parsePlansSection(plans, path) } : {}),
    ...(reload !== undefined
      ? { reload: parseReloadSection(reload, path) }
      : {}),
    ...(realtime !== undefined
      ? { realtime: parseRealtimeSection(realtime, path) }
      : {}),
    ...(rotations !== undefined
      ? { rotations: parseRotationsSection(rotations, path) }
      : {}),
    ...(baselines !== undefined
      ? { baselines: parseBaselinesSection(baselines, path) }
      : {}),
  };
}

function parseEpochSnapshot(raw: unknown, path: string): EpochSnapshot {
  const obj = requireObject(raw, path);
  if (
    Reflect.get(obj, "schemaVersion") !== EPOCH_SCHEMA_VERSION ||
    Reflect.get(obj, "epoch") !== CURRENT_EPOCH
  ) {
    throw new Error(`${path} is not a valid Epoch ${CURRENT_EPOCH} snapshot.`);
  }
  const pr = requireOptionalPositiveInt(obj, "pr", path);
  const notes = requireOptionalString(obj, "notes", path);
  return {
    schemaVersion: EPOCH_SCHEMA_VERSION,
    epoch: CURRENT_EPOCH,
    id: requireString(obj, "id", path),
    label: requireString(obj, "label", path),
    kind: requireKind(obj, path),
    recordedAt: requireString(obj, "recordedAt", path),
    revision: requireString(obj, "revision", path),
    dirty: requireBoolean(obj, "dirty", path),
    ...(pr !== undefined ? { pr } : {}),
    issues: requireNumberArray(obj, "issues", path),
    runtime: parseRuntime(Reflect.get(obj, "runtime"), path),
    ...(notes !== undefined ? { notes } : {}),
    ...parseOptionalSections(obj, path),
  };
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
      const snapshot = parseEpochSnapshot(
        JSON.parse(await readFile(path, "utf8")),
        path,
      );
      if (snapshot.id !== entry.id) {
        throw new Error(
          `Snapshot ${path} id '${snapshot.id}' does not match manifest entry '${entry.id}'.`,
        );
      }
      return snapshot;
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

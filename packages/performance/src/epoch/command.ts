import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { repositoryRoot } from "../reportFiles";
import { compareSnapshots } from "./analyze";
import { extractCanariesMetrics, extractInventoryMetrics } from "./extract";
import {
  extractBaselineMetrics,
  extractPlansMetrics,
  extractRealtimeMetrics,
  extractReloadMetrics,
  extractRotationMetrics,
  extractScenariosMetrics,
} from "./extractProbes";
import { formatComparisonMarkdown } from "./markdown";
import { type EpochOptions, epochUsage, parseEpochOptions } from "./options";
import {
  CURRENT_EPOCH,
  EPOCH_SCHEMA_VERSION,
  type EpochManifest,
  type EpochManifestEntry,
  type EpochRuntimeInfo,
  type EpochSnapshot,
} from "./schema";
import {
  epochDir,
  loadAllSnapshots,
  loadManifest,
  writeEpochViews,
} from "./storage";

export interface EpochHost {
  readonly repoRoot: string;
  readonly resultsDir: string;
  readonly print: (text: string) => void;
}

const defaultHost: EpochHost = {
  repoRoot: repositoryRoot,
  resultsDir: resolve(repositoryRoot, "packages/performance/results"),
  print: (text) => console.log(text),
};

function currentRuntime(): EpochRuntimeInfo {
  return {
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? null,
  };
}

type RecordOptions = Extract<EpochOptions, { mode: "record" }>;
type AnalyzeOptions = Extract<EpochOptions, { mode: "analyze" }>;

async function runAnalyzeMode(
  options: AnalyzeOptions,
  resultsDir: string,
  host: EpochHost,
): Promise<number> {
  const manifest = await loadManifest(resultsDir);
  const snapshots = await loadAllSnapshots(resultsDir, manifest);
  if (snapshots.length < 2) {
    throw new Error(
      `Need at least 2 recorded Epoch ${CURRENT_EPOCH} snapshots to analyze (found ${snapshots.length}).`,
    );
  }
  const before = options.from
    ? snapshots.find((s) => s.id === options.from)
    : snapshots[0];
  const after = options.to
    ? snapshots.find((s) => s.id === options.to)
    : snapshots.at(-1);
  if (!before) throw new Error(`Unknown --from snapshot: ${options.from}`);
  if (!after) throw new Error(`Unknown --to snapshot: ${options.to}`);
  const comparison = compareSnapshots(before, after);
  host.print(
    options.json
      ? JSON.stringify(comparison, null, 2)
      : formatComparisonMarkdown(comparison),
  );
  return 0;
}

async function extractOptional<T>(
  repoRoot: string,
  inputPath: string | undefined,
  loader: (resolvedPath: string) => Promise<T>,
): Promise<T | undefined> {
  return inputPath ? loader(resolve(repoRoot, inputPath)) : undefined;
}

function gitSourceIdentity(repoRoot: string): {
  readonly revision: string;
  readonly dirty: boolean;
} {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  return {
    revision: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain").length > 0,
  };
}

async function readReportProvenance(
  path: string,
): Promise<{ readonly revision?: string; readonly dirty?: boolean }> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) return {};
  const revision = Reflect.get(parsed, "revision");
  const dirty = Reflect.get(parsed, "dirty");
  return {
    ...(typeof revision === "string" && revision.length > 0
      ? { revision }
      : {}),
    ...(typeof dirty === "boolean" ? { dirty } : {}),
  };
}

async function resolveProvenance(
  options: RecordOptions,
  repoRoot: string,
): Promise<{ readonly revision: string; readonly dirty: boolean }> {
  const inputPaths = [
    options.canaries,
    options.inventory,
    options.plans,
    options.scenarios,
    options.reload,
    options.realtime,
    options.rotations,
    options.baselines,
  ].filter((p): p is string => p !== undefined);

  const sources = await Promise.all(
    inputPaths.map((p) => readReportProvenance(resolve(repoRoot, p))),
  );
  const revisions = [
    ...new Set(
      sources
        .map((s) => s.revision)
        .filter((r): r is string => r !== undefined),
    ),
  ];
  if (revisions.length > 1) {
    throw new Error(
      `Input reports come from different revisions: ${revisions.join(", ")}.`,
    );
  }
  const revision = revisions[0];
  if (revision !== undefined) {
    return { revision, dirty: sources.some((s) => s.dirty === true) };
  }
  return gitSourceIdentity(repoRoot);
}

async function buildSnapshot(
  options: RecordOptions,
  repoRoot: string,
): Promise<EpochSnapshot> {
  const [
    canariesExtracted,
    inventory,
    plans,
    scenarios,
    reload,
    realtime,
    rotations,
    baselines,
  ] = await Promise.all([
    extractOptional(repoRoot, options.canaries, extractCanariesMetrics),
    extractOptional(repoRoot, options.inventory, extractInventoryMetrics),
    extractOptional(repoRoot, options.plans, extractPlansMetrics),
    extractOptional(repoRoot, options.scenarios, extractScenariosMetrics),
    extractOptional(repoRoot, options.reload, extractReloadMetrics),
    extractOptional(repoRoot, options.realtime, extractRealtimeMetrics),
    extractOptional(repoRoot, options.rotations, extractRotationMetrics),
    extractOptional(repoRoot, options.baselines, extractBaselineMetrics),
  ]);

  const provenance = await resolveProvenance(options, repoRoot);
  return {
    schemaVersion: EPOCH_SCHEMA_VERSION,
    epoch: CURRENT_EPOCH,
    id: options.id,
    label: options.label,
    kind: options.kind,
    recordedAt: new Date().toISOString(),
    revision: provenance.revision,
    dirty: provenance.dirty,
    ...(options.pr !== undefined ? { pr: options.pr } : {}),
    issues: options.issues,
    runtime: canariesExtracted?.runtime ?? currentRuntime(),
    ...(options.notes ? { notes: options.notes } : {}),
    ...(inventory ? { inventory } : {}),
    ...(canariesExtracted ? { canaries: canariesExtracted.metrics } : {}),
    ...(scenarios ? { scenarios } : {}),
    ...(plans ? { plans } : {}),
    ...(reload ? { reload } : {}),
    ...(realtime ? { realtime } : {}),
    ...(rotations ? { rotations } : {}),
    ...(baselines ? { baselines } : {}),
  };
}

function upsertManifestEntry(
  manifest: EpochManifest,
  snapshot: EpochSnapshot,
  snapshotFile: string,
): EpochManifest {
  const existingIndex = manifest.entries.findIndex((e) => e.id === snapshot.id);
  const seq =
    existingIndex >= 0
      ? (manifest.entries[existingIndex]?.seq ?? existingIndex)
      : manifest.entries.length;
  const entry: EpochManifestEntry = {
    id: snapshot.id,
    seq,
    label: snapshot.label,
    kind: snapshot.kind,
    recordedAt: snapshot.recordedAt,
    revision: snapshot.revision,
    dirty: snapshot.dirty,
    ...(snapshot.pr !== undefined ? { pr: snapshot.pr } : {}),
    issues: snapshot.issues,
    snapshotFile,
    ...(snapshot.notes ? { notes: snapshot.notes } : {}),
  };
  const entries = [...manifest.entries];
  if (existingIndex >= 0) entries[existingIndex] = entry;
  else entries.push(entry);
  return { ...manifest, entries };
}

async function runRecordMode(
  options: RecordOptions,
  resultsDir: string,
  host: EpochHost,
): Promise<number> {
  const snapshot = await buildSnapshot(options, host.repoRoot);
  const manifest = await loadManifest(resultsDir);
  // Validate existing snapshots before writing so a corrupt ledger aborts cleanly.
  const existingSnapshots = await loadAllSnapshots(resultsDir, manifest);
  const snapshotFile = `snapshots/${options.id}.json`;
  const updatedManifest = upsertManifestEntry(manifest, snapshot, snapshotFile);
  const existingIndex = existingSnapshots.findIndex(
    (s) => s.id === snapshot.id,
  );
  const snapshots = [...existingSnapshots];
  if (existingIndex >= 0) snapshots[existingIndex] = snapshot;
  else snapshots.push(snapshot);

  const dir = epochDir(resultsDir);
  await mkdir(join(dir, "snapshots"), { recursive: true });
  await writeFile(
    join(dir, snapshotFile),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
  await writeEpochViews(resultsDir, updatedManifest, snapshots);

  host.print(
    `Recorded Epoch ${CURRENT_EPOCH} snapshot '${options.id}' at ${snapshot.revision.slice(0, 9)} (${join(dir, snapshotFile)}).`,
  );
  const recordedIndex = snapshots.findIndex((s) => s.id === options.id);
  const prev = recordedIndex > 0 ? snapshots[recordedIndex - 1] : undefined;
  const curr = recordedIndex >= 0 ? snapshots[recordedIndex] : undefined;
  if (prev && curr) {
    host.print("");
    host.print(formatComparisonMarkdown(compareSnapshots(prev, curr)));
  }
  return 0;
}

/** Runs `perf:epoch record|analyze|render`. */
export async function runEpochCommand(
  args: readonly string[],
  host = defaultHost,
): Promise<number> {
  const options = parseEpochOptions(args);
  if (!options) {
    host.print(epochUsage);
    return 0;
  }
  const resultsDir = options.resultsDir
    ? resolve(host.repoRoot, options.resultsDir)
    : host.resultsDir;

  if (options.mode === "render") {
    const manifest = await loadManifest(resultsDir);
    const snapshots = await loadAllSnapshots(resultsDir, manifest);
    await writeEpochViews(resultsDir, manifest, snapshots);
    host.print(
      `Rendered Epoch ${manifest.epoch} views (${snapshots.length} snapshots) under ${resultsDir}.`,
    );
    return 0;
  }
  if (options.mode === "analyze") {
    return runAnalyzeMode(options, resultsDir, host);
  }
  return runRecordMode(options, resultsDir, host);
}

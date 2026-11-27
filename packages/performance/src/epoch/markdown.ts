import {
  compareSnapshots,
  type EpochComparison,
  type MetricDelta,
} from "./analyze";
import { epochMetricDescriptors } from "./descriptors";
import {
  fmtNum,
  formatMarkdownTable,
  renderLatestBreakdowns,
} from "./markdownBreakdowns";
import type { EpochManifest, EpochSnapshot } from "./schema";

function fmtDelta(item: MetricDelta): string {
  if (item.delta === 0) return "0";
  const sign = item.delta > 0 ? "+" : "";
  const pct = item.deltaPct === null ? "" : ` (${sign}${item.deltaPct}%)`;
  return `${sign}${fmtNum(item.delta)}${pct}`;
}

function verdictBadge(verdict: MetricDelta["verdict"]): string {
  switch (verdict) {
    case "improved":
      return "improved";
    case "regressed":
      return "REGRESSED";
    case "changed":
      return "changed";
    case "unchanged":
      return "unchanged";
  }
}

function wrapProse(text: string, width = 78): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Formats a before-vs-after comparison between two Epoch 2 snapshots. */
export function formatComparisonMarkdown(comparison: EpochComparison): string {
  const lines = [
    `# Epoch 2 Comparison: \`${comparison.beforeId}\` -> \`${comparison.afterId}\``,
    "",
    ...wrapProse(
      `Revisions: \`${comparison.beforeRevision.slice(0, 9)}\` -> \`${comparison.afterRevision.slice(0, 9)}\`. ` +
        `Improvements: **${comparison.improvements.length}**, ` +
        `Regressions: **${comparison.regressions.length}**, ` +
        `Tradeoffs: **${comparison.tradeoffs.length}**.`,
    ),
    "",
    ...formatMarkdownTable(
      ["Dimension", "Metric", "Before", "After", "Delta", "Verdict"],
      comparison.metrics.map((item) => [
        item.dimension,
        item.label,
        `${fmtNum(item.before)} ${item.unit}`,
        `${fmtNum(item.after)} ${item.unit}`,
        fmtDelta(item),
        verdictBadge(item.verdict),
      ]),
      [false, false, true, true, true, false],
    ),
  ];

  if (comparison.tradeoffs.length > 0) {
    lines.push(
      "",
      "## Tradeoffs Detected",
      "",
      ...formatMarkdownTable(
        [
          "Improved Dimension",
          "Improvement",
          "Regressed Dimension",
          "Regression",
        ],
        comparison.tradeoffs.map((item) => [
          item.improvedDimension,
          item.improvedSummary,
          item.regressedDimension,
          item.regressedSummary,
        ]),
        [false, false, false, false],
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatMetricCell(
  value: number | null | undefined,
  unit: string,
): string {
  return value === undefined || value === null
    ? "—"
    : `${fmtNum(value)} ${unit}`;
}

function scorecardVerdict(
  item: MetricDelta | undefined,
  sameSnapshot: boolean,
): string {
  if (item) return verdictBadge(item.verdict);
  return sameSnapshot ? "baseline" : "n/a";
}

function renderScorecardRows(
  baseline: EpochSnapshot,
  latest: EpochSnapshot,
): string[][] {
  const sameSnapshot = baseline.id === latest.id;
  const comparison = sameSnapshot ? null : compareSnapshots(baseline, latest);
  const deltaByKey = new Map(
    comparison?.metrics.map((item) => [item.key, item]) ?? [],
  );
  const rows: string[][] = [];
  for (const descriptor of epochMetricDescriptors) {
    const baseVal = descriptor.pick(baseline);
    const latestVal = descriptor.pick(latest);
    if (
      (baseVal === undefined || baseVal === null) &&
      (latestVal === undefined || latestVal === null)
    ) {
      continue;
    }
    const item = deltaByKey.get(descriptor.key);
    rows.push([
      descriptor.dimension,
      descriptor.label,
      formatMetricCell(baseVal, descriptor.unit),
      formatMetricCell(latestVal, descriptor.unit),
      item ? fmtDelta(item) : "—",
      scorecardVerdict(item, sameSnapshot),
    ]);
  }
  return rows;
}

function renderCheckpointLog(
  manifest: EpochManifest,
  snapshots: readonly EpochSnapshot[],
): string[] {
  const byId = new Map(snapshots.map((snap) => [snap.id, snap]));
  const rows: string[][] = [];
  for (const [index, entry] of manifest.entries.entries()) {
    const current = byId.get(entry.id);
    const prevEntry = index > 0 ? manifest.entries[index - 1] : undefined;
    const prev = prevEntry ? byId.get(prevEntry.id) : undefined;
    const diff = prev && current ? compareSnapshots(prev, current) : null;
    const prCell = entry.pr ? `#${entry.pr}` : "—";
    const issuesCell =
      entry.issues.length > 0
        ? entry.issues.map((id) => `#${id}`).join(", ")
        : "—";
    const summaryCell =
      diff === null
        ? "Epoch baseline"
        : `${diff.improvements.length} improved, ${diff.regressions.length} regressed, ${diff.tradeoffs.length} tradeoffs`;
    rows.push([
      `\`${entry.id}\``,
      entry.kind,
      `\`${entry.revision.slice(0, 9)}\``,
      prCell,
      issuesCell,
      entry.label,
      summaryCell,
    ]);
  }
  return formatMarkdownTable(
    ["Checkpoint", "Kind", "Revision", "PR", "Issues", "Label", "Step Summary"],
    rows,
    [false, false, false, false, false, false, false],
  );
}

function renderStepComparisons(snapshots: readonly EpochSnapshot[]): string[] {
  if (snapshots.length < 2) return [];
  const lines = ["", "## Step-by-Step Deltas & Tradeoffs"];
  for (let index = 1; index < snapshots.length; index += 1) {
    const before = snapshots[index - 1];
    const after = snapshots[index];
    if (!before || !after) continue;
    const diff = compareSnapshots(before, after);
    lines.push(
      "",
      `### \`${before.id}\` -> \`${after.id}\` (${after.label})`,
      "",
      ...wrapProse(
        `Revisions: \`${before.revision.slice(0, 9)}\` -> \`${after.revision.slice(0, 9)}\`. ` +
          `Improved: **${diff.improvements.length}**, Regressed: **${diff.regressions.length}**, ` +
          `Tradeoffs: **${diff.tradeoffs.length}**.`,
      ),
    );
    if (after.notes) lines.push("", ...wrapProse(`Notes: ${after.notes}`));
    const moved = diff.metrics.filter((item) => item.verdict !== "unchanged");
    if (moved.length > 0) {
      lines.push(
        "",
        ...formatMarkdownTable(
          ["Dimension", "Metric", "Before", "After", "Delta", "Verdict"],
          moved.map((item) => [
            item.dimension,
            item.label,
            `${fmtNum(item.before)} ${item.unit}`,
            `${fmtNum(item.after)} ${item.unit}`,
            fmtDelta(item),
            verdictBadge(item.verdict),
          ]),
          [false, false, true, true, true, false],
        ),
      );
    }
    if (diff.tradeoffs.length > 0) {
      lines.push("", "**Tradeoffs:**");
      for (const tradeoff of diff.tradeoffs) {
        lines.push(
          ...wrapProse(
            `- **${tradeoff.improvedDimension}** (${tradeoff.improvedSummary}) vs **${tradeoff.regressedDimension}** (${tradeoff.regressedSummary})`,
          ),
        );
      }
    }
  }
  return lines;
}

/** Generates `packages/performance/results/epoch-2/TRENDS.md`. */
export function formatEpochTrendsMarkdown(
  manifest: EpochManifest,
  snapshots: readonly EpochSnapshot[],
): string {
  const baseline = snapshots[0];
  const latest = snapshots.at(-1);
  const lines = [
    `# Performance Epoch ${manifest.epoch}: ${manifest.title}`,
    "",
    ...wrapProse(`${manifest.description} Started ${manifest.startedAt}.`),
    "",
    "## Checkpoints",
    "",
    ...renderCheckpointLog(manifest, snapshots),
  ];
  if (baseline && latest) {
    lines.push(
      "",
      `## Cumulative Scorecard (\`${baseline.id}\` -> \`${latest.id}\`)`,
      "",
      ...formatMarkdownTable(
        ["Dimension", "Metric", "Baseline", "Latest", "Delta", "Verdict"],
        renderScorecardRows(baseline, latest),
        [false, false, true, true, true, false],
      ),
      ...renderStepComparisons(snapshots),
      ...renderLatestBreakdowns(latest),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Generates `packages/performance/results/README.md` for Epoch 2. */
export function formatResultsIndexMarkdown(
  manifest: EpochManifest,
  snapshots: readonly EpochSnapshot[],
): string {
  const baseline = snapshots[0];
  const latest = snapshots.at(-1);
  const lines = [
    "# Performance results",
    "",
    `Structured longitudinal performance ledger for Tearleads (**Epoch ${manifest.epoch}**).`,
    "Previous ad-hoc Epoch 1 markdown reports were pruned when Epoch 2 began so every",
    "checkpoint is machine-readable JSON with automated improvement, regression, and",
    "cross-dimension tradeoff analysis.",
    "",
    `- Manifest: [epoch-${manifest.epoch}/manifest.json](epoch-${manifest.epoch}/manifest.json)`,
    `- Full trend & tradeoff report: [epoch-${manifest.epoch}/TRENDS.md](epoch-${manifest.epoch}/TRENDS.md)`,
    "- Raw captures remain private under `.test_files/performance/`.",
    "",
    "## Commands",
    "",
    "```sh",
    "bun run perf:epoch record --id <seq-slug> --label '<description>' \\",
    "  --canaries .test_files/performance/canaries-<id>.json \\",
    "  --inventory .test_files/performance/inventory-<ts>.json \\",
    "  --plans .test_files/performance/plans-<id>.json \\",
    "  --scenarios .test_files/performance/scenarios-<id>.json",
    "bun run perf:epoch analyze --from 000-baseline --to <latest-id>",
    "bun run perf:epoch render",
    "```",
  ];
  if (baseline && latest) {
    lines.push(
      "",
      `## Epoch ${manifest.epoch} Scorecard (\`${baseline.id}\` -> \`${latest.id}\`)`,
      "",
      `Baseline \`${baseline.revision.slice(0, 9)}\` -> Latest \`${latest.revision.slice(0, 9)}\` ` +
        `(${manifest.entries.length} checkpoint${manifest.entries.length === 1 ? "" : "s"} recorded).`,
      "",
      ...formatMarkdownTable(
        ["Dimension", "Metric", "Baseline", "Latest", "Delta", "Verdict"],
        renderScorecardRows(baseline, latest),
        [false, false, true, true, true, false],
      ),
      "",
      "## Checkpoints",
      "",
      ...renderCheckpointLog(manifest, snapshots),
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Summarizer and Markdown formatter for client SQLite statement and
 * serialized mutation-lock captures (`perf:canaries --client-statements`).
 */

export type ClientSqlRecord =
  | {
      readonly kind: "stmt";
      readonly label: string;
      readonly sql: string;
      readonly bindCount: number;
      readonly durationMs: number;
      readonly rows: number;
      readonly inLock: boolean;
      readonly failed: boolean;
    }
  | {
      readonly kind: "mutation";
      readonly label: string;
      readonly waitMs: number;
      readonly holdMs: number;
      readonly statements: number;
      readonly failed: boolean;
    }
  | { readonly phaseStart: string }
  | { readonly phaseEnd: string; readonly requests: number }
  | { readonly truncated: number };

export interface ClientSqlTopEntry {
  readonly sql: string;
  readonly count: number;
  readonly durationMs: number;
  readonly planFlags?: readonly string[];
}

export interface ClientSqlGroupSummary {
  readonly label: string;
  readonly statements: number;
  readonly inLockStatements: number;
  readonly durationMs: number;
  readonly mutations: number;
  readonly maxMutationHoldMs: number;
  readonly maxMutationWaitMs: number;
  readonly maxStatementsPerMutation: number;
  readonly avgStatementsPerMutation: number;
  readonly top: readonly ClientSqlTopEntry[];
}

export interface ClientSqlSummary extends ClientSqlGroupSummary {
  readonly truncated: boolean;
  readonly phases: readonly ClientSqlGroupSummary[];
}

type StmtRecord = Extract<ClientSqlRecord, { kind: "stmt" }>;
type MutationRecord = Extract<ClientSqlRecord, { kind: "mutation" }>;

/** Collapses whitespace and runs of `?` / `$n` bind placeholders. */
export function normalizeClientSql(sql: string): string {
  return sql
    .replace(/\s+/gu, " ")
    .replace(/\?(?:\s*,\s*\?)+/gu, "?, …")
    .replace(/\$\d+(?:\s*,\s*\$\d+)+/gu, "$n, …")
    .trim();
}

function isStmtRecord(value: object): value is StmtRecord {
  return (
    Reflect.get(value, "kind") === "stmt" &&
    typeof Reflect.get(value, "label") === "string" &&
    typeof Reflect.get(value, "sql") === "string" &&
    typeof Reflect.get(value, "durationMs") === "number"
  );
}

function isMutationRecord(value: object): value is MutationRecord {
  return (
    Reflect.get(value, "kind") === "mutation" &&
    typeof Reflect.get(value, "label") === "string" &&
    typeof Reflect.get(value, "holdMs") === "number" &&
    typeof Reflect.get(value, "statements") === "number"
  );
}

function isClientSqlRecord(value: unknown): value is ClientSqlRecord {
  if (typeof value !== "object" || value === null) return false;
  return (
    isStmtRecord(value) ||
    isMutationRecord(value) ||
    typeof Reflect.get(value, "phaseStart") === "string" ||
    (typeof Reflect.get(value, "phaseEnd") === "string" &&
      typeof Reflect.get(value, "requests") === "number") ||
    typeof Reflect.get(value, "truncated") === "number"
  );
}

export function parseClientSqlCapture(text: string): ClientSqlRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      const value: unknown = JSON.parse(line);
      if (!isClientSqlRecord(value)) {
        throw new Error(`Client SQL capture line ${index + 1} is invalid.`);
      }
      return value;
    });
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function summarizeGroup(
  label: string,
  stmts: readonly StmtRecord[],
  mutations: readonly MutationRecord[],
  limit = 10,
): ClientSqlGroupSummary {
  const bySql = new Map<string, { count: number; durationMs: number }>();
  let inLockStatements = 0;
  let durationMs = 0;
  for (const stmt of stmts) {
    const sql = normalizeClientSql(stmt.sql);
    const entry = bySql.get(sql) ?? { count: 0, durationMs: 0 };
    entry.count += 1;
    entry.durationMs += stmt.durationMs;
    bySql.set(sql, entry);
    durationMs += stmt.durationMs;
    if (stmt.inLock) inLockStatements += 1;
  }

  let maxMutationHoldMs = 0;
  let maxMutationWaitMs = 0;
  let maxStatementsPerMutation = 0;
  let totalMutationStmts = 0;
  for (const mut of mutations) {
    if (mut.holdMs > maxMutationHoldMs) maxMutationHoldMs = mut.holdMs;
    if (mut.waitMs > maxMutationWaitMs) maxMutationWaitMs = mut.waitMs;
    if (mut.statements > maxStatementsPerMutation)
      maxStatementsPerMutation = mut.statements;
    totalMutationStmts += mut.statements;
  }

  const top = [...bySql]
    .map(([sql, stat]) => ({
      sql,
      count: stat.count,
      durationMs: roundMs(stat.durationMs),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.durationMs - a.durationMs ||
        (a.sql < b.sql ? -1 : a.sql > b.sql ? 1 : 0),
    )
    .slice(0, limit);

  return {
    label,
    statements: stmts.length,
    inLockStatements,
    durationMs: roundMs(durationMs),
    mutations: mutations.length,
    maxMutationHoldMs: roundMs(maxMutationHoldMs),
    maxMutationWaitMs: roundMs(maxMutationWaitMs),
    maxStatementsPerMutation,
    avgStatementsPerMutation:
      mutations.length === 0
        ? 0
        : Math.round((totalMutationStmts / mutations.length) * 10) / 10,
    top,
  };
}

interface PhaseWindow {
  readonly label: string;
  readonly stmtStart: number;
  readonly stmtEnd: number;
  readonly mutStart: number;
  readonly mutEnd: number;
}

function collectClientRecords(records: readonly ClientSqlRecord[]) {
  const stmts: StmtRecord[] = [];
  const mutations: MutationRecord[] = [];
  const openStarts = new Map<string, { stmt: number; mut: number }[]>();
  const windows: PhaseWindow[] = [];
  let truncated = false;
  for (const record of records) {
    if ("truncated" in record) {
      truncated = true;
    } else if ("phaseStart" in record) {
      const stack = openStarts.get(record.phaseStart) ?? [];
      stack.push({ stmt: stmts.length, mut: mutations.length });
      openStarts.set(record.phaseStart, stack);
    } else if ("phaseEnd" in record) {
      const matched = openStarts.get(record.phaseEnd)?.pop();
      const prev = windows.at(-1);
      windows.push({
        label: record.phaseEnd,
        stmtStart: matched?.stmt ?? prev?.stmtEnd ?? 0,
        stmtEnd: stmts.length,
        mutStart: matched?.mut ?? prev?.mutEnd ?? 0,
        mutEnd: mutations.length,
      });
    } else if (record.kind === "stmt") {
      stmts.push(record);
    } else {
      mutations.push(record);
    }
  }
  return { stmts, mutations, windows, truncated };
}

export function summarizeClientSqlCapture(
  records: readonly ClientSqlRecord[],
  limit = 10,
): ClientSqlSummary {
  const { stmts, mutations, windows, truncated } =
    collectClientRecords(records);
  const overall = summarizeGroup("total", stmts, mutations, limit);
  return {
    ...overall,
    truncated,
    phases: windows.map((win) =>
      summarizeGroup(
        win.label,
        stmts.slice(win.stmtStart, win.stmtEnd),
        mutations.slice(win.mutStart, win.mutEnd),
        limit,
      ),
    ),
  };
}

const integers = new Intl.NumberFormat("en-US");

function sqlCell(sql: string): string {
  const short = sql.length > 200 ? `${sql.slice(0, 200)}…` : sql;
  return `\`${short.replaceAll("`", "'").replaceAll("|", "\\|")}\``;
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

/** Formats a client SQLite capture summary as Markdown sections. */
export function formatClientSqlMarkdown(
  heading: string,
  summary: ClientSqlSummary,
): string[] {
  const lines = [
    "",
    `## ${heading}`,
    "",
    `${integers.format(summary.statements)} local SQLite statements ` +
      `(${integers.format(summary.inLockStatements)} inside mutation locks, ` +
      `${summary.durationMs.toFixed(1)} ms total). ` +
      `${integers.format(summary.mutations)} serialized mutations ` +
      `(avg ${summary.avgStatementsPerMutation} stmts/tx, max ${integers.format(summary.maxStatementsPerMutation)} stmts/tx, ` +
      `max hold ${summary.maxMutationHoldMs.toFixed(1)} ms, max wait ${summary.maxMutationWaitMs.toFixed(1)} ms).`,
  ];
  if (summary.truncated) {
    lines.push(
      "",
      "Capture reached its record limit; counts are lower bounds.",
    );
  }
  if (summary.phases.length > 0) {
    lines.push(
      "",
      "### Client SQLite by phase",
      "",
      "| Phase | Stmts | In lock | SQL ms | Mutations | Avg stmts/tx | Max hold ms |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...summary.phases.map(
        (phase) =>
          `| ${cell(phase.label)} | ${integers.format(phase.statements)} | ${integers.format(phase.inLockStatements)} | ${phase.durationMs.toFixed(1)} | ${integers.format(phase.mutations)} | ${phase.avgStatementsPerMutation} | ${phase.maxMutationHoldMs.toFixed(1)} |`,
      ),
    );
  }
  if (summary.top.length > 0) {
    lines.push(
      "",
      "### Top client SQLite statements",
      "",
      "| Count | Total ms | Statement |",
      "| ---: | ---: | --- |",
      ...summary.top.map(
        (item) =>
          `| ${integers.format(item.count)} | ${item.durationMs.toFixed(1)} | ${sqlCell(item.sql)} |`,
      ),
    );
  }
  return lines;
}

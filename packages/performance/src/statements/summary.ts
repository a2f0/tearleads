import type { CaptureRecord } from "./recorder";

export interface StatementCount {
  readonly sql: string;
  readonly count: number;
}

/** The statements recorded under one label, or within one canary phase. */
export interface StatementGroup {
  readonly label: string;
  readonly statements: number;
  /** Distinct request scopes the statements ran in. */
  readonly requestScopes: number;
  /** The most repeated normalized statements, most first. */
  readonly top: readonly StatementCount[];
  /**
   * Statements sent more than once with the same bind values within one
   * request scope (or, outside every scope, within the group), or null when
   * the capture has no parameter hashes to tell keys apart.
   */
  readonly sameKeyRepeats: readonly StatementCount[] | null;
}

export interface PhaseStatements extends StatementGroup {
  /** The phase's request count from its metrics line. */
  readonly requests: number;
}

export interface StatementSummary {
  readonly statements: number;
  /** The capture stopped at its record limit; counts are lower bounds. */
  readonly truncated: boolean;
  readonly paramHashes: boolean;
  readonly top: readonly StatementCount[];
  /** In the order each label first appears. */
  readonly labels: readonly StatementGroup[];
  /**
   * One per canary phase marker: the statements since the previous marker,
   * so the first phase also holds the setup before it.
   */
  readonly phases: readonly PhaseStatements[];
}

type StatementRecord = Extract<CaptureRecord, { sql: string }>;

/**
 * Collapses whitespace and runs of bind placeholders, so a list of three
 * ids and a list of five read as one statement.
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/gu, " ")
    .replace(/\$\d+(?:\s*,\s*\$\d+)+/gu, "$n, …")
    .trim();
}

function isCaptureRecord(value: unknown): value is CaptureRecord {
  if (typeof value !== "object" || value === null) return false;
  const field = (name: string): unknown => Reflect.get(value, name);
  return (
    (typeof field("label") === "string" &&
      typeof field("sql") === "string" &&
      typeof field("params") === "number") ||
    (typeof field("phaseEnd") === "string" &&
      typeof field("requests") === "number") ||
    typeof field("truncated") === "number"
  );
}

export function parseCapture(text: string): CaptureRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      const value: unknown = JSON.parse(line);
      if (!isCaptureRecord(value))
        throw new Error(`Capture line ${index + 1} is not a capture record.`);
      return value;
    });
}

function ranked(counts: Map<string, number>, limit: number): StatementCount[] {
  return [...counts]
    .map(([sql, count]) => ({ sql, count }))
    .sort(
      (a, b) =>
        b.count - a.count || (a.sql < b.sql ? -1 : a.sql > b.sql ? 1 : 0),
    )
    .slice(0, limit);
}

function group(
  label: string,
  statements: readonly StatementRecord[],
  paramHashes: boolean,
  limit: number,
): StatementGroup {
  const bySql = new Map<string, number>();
  const byKey = new Map<string, { sql: string; count: number }>();
  const requestScopes = new Set<number>();
  for (const statement of statements) {
    const sql = normalizeSql(statement.sql);
    bySql.set(sql, (bySql.get(sql) ?? 0) + 1);
    if (statement.request !== undefined) requestScopes.add(statement.request);
    if (statement.paramHash === undefined) continue;
    const key = `${statement.request ?? ""} ${statement.paramHash} ${sql}`;
    const entry = byKey.get(key) ?? { sql, count: 0 };
    entry.count += 1;
    byKey.set(key, entry);
  }
  const repeats = new Map<string, number>();
  for (const { sql, count } of byKey.values())
    if (count > 1) repeats.set(sql, (repeats.get(sql) ?? 0) + count - 1);
  return {
    label,
    statements: statements.length,
    requestScopes: requestScopes.size,
    top: ranked(bySql, limit),
    sameKeyRepeats: paramHashes ? ranked(repeats, limit) : null,
  };
}

/** Summarizes a capture; `limit` caps each ranked list. */
export function summarizeCapture(
  records: readonly CaptureRecord[],
  limit = 10,
): StatementSummary {
  const statements: StatementRecord[] = [];
  const markers: {
    label: string;
    requests: number;
    start: number;
    end: number;
  }[] = [];
  let truncated = false;
  for (const record of records) {
    if ("truncated" in record) truncated = true;
    else if ("phaseEnd" in record)
      markers.push({
        label: record.phaseEnd,
        requests: record.requests,
        start: markers.at(-1)?.end ?? 0,
        end: statements.length,
      });
    else statements.push(record);
  }
  const paramHashes = statements.some(
    (statement) => statement.paramHash !== undefined,
  );
  const byLabel = new Map<string, StatementRecord[]>();
  for (const statement of statements)
    byLabel.set(statement.label, [
      ...(byLabel.get(statement.label) ?? []),
      statement,
    ]);
  return {
    statements: statements.length,
    truncated,
    paramHashes,
    top: group("", statements, false, limit).top,
    labels: [...byLabel].map(([label, list]) =>
      group(label, list, paramHashes, limit),
    ),
    phases: markers.map((marker) => ({
      ...group(
        marker.label,
        statements.slice(marker.start, marker.end),
        paramHashes,
        limit,
      ),
      requests: marker.requests,
    })),
  };
}

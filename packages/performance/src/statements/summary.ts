import type { CaptureRecord } from "./recorder";
import {
  isLockStatement,
  isReadOnlySelect,
  sqlReadTables,
  sqlWriteTables,
} from "./sqlAnalysis";

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
  /** Statements executed inside a managed database transaction (strictly serial). */
  readonly txStatements: number;
  /** Distinct managed transactions observed in this group. */
  readonly transactions: number;
  /** Statements issued inside a transaction after an explicit lock statement. */
  readonly lockHoldStatements: number;
  /** The most repeated normalized statements, most first. */
  readonly top: readonly StatementCount[];
  /**
   * Statements sent more than once with the same bind values within one
   * request scope (or, outside every scope, within the group), or null when
   * the capture has no parameter hashes to tell keys apart.
   */
  readonly sameKeyRepeats: readonly StatementCount[] | null;
  /**
   * Same-key SELECT repeats where no INSERT/UPDATE/DELETE touched any table
   * read by the query between consecutive sends in the same scope.
   */
  readonly pureReadRepeats: readonly StatementCount[] | null;
}

export interface PhaseStatements extends StatementGroup {
  /** The phase's request count from its metrics line. */
  readonly requests: number;
  /** True when the phase had a matching `phaseStart` marker. */
  readonly exactWindow: boolean;
}

/** Aggregated statement metrics for one matched HTTP route template. */
export interface RouteStatementSummary {
  readonly route: string;
  readonly requests: number;
  readonly statements: number;
  readonly txStatements: number;
  readonly lockHoldStatements: number;
  readonly maxPerRequest: number;
  readonly sameKeyRepeats: number | null;
  readonly pureReadRepeats: number | null;
  readonly topRepeat: StatementCount | null;
}

export interface StatementSummary {
  readonly statements: number;
  /** The capture stopped at its record limit; counts are lower bounds. */
  readonly truncated: boolean;
  readonly paramHashes: boolean;
  readonly txStatements: number;
  readonly transactions: number;
  readonly lockHoldStatements: number;
  readonly top: readonly StatementCount[];
  /** In the order each label first appears. */
  readonly labels: readonly StatementGroup[];
  /**
   * One per canary phase marker: from its matching `phaseStart` when present,
   * otherwise from the previous `phaseEnd`.
   */
  readonly phases: readonly PhaseStatements[];
  /** Per-route statement breakdown when request-scope metadata was recorded. */
  readonly routes: readonly RouteStatementSummary[];
}

type StatementRecord = Extract<CaptureRecord, { sql: string }>;
type RequestScopeRecord = Extract<CaptureRecord, { requestScope: number }>;

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
    typeof field("phaseStart") === "string" ||
    (typeof field("phaseEnd") === "string" &&
      typeof field("requests") === "number") ||
    (typeof field("requestScope") === "number" &&
      typeof field("method") === "string" &&
      typeof field("route") === "string" &&
      typeof field("status") === "number") ||
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

interface RepeatTracker {
  readonly seenKeys: Map<string, number>;
  readonly tableWriteSeq: Map<string, number>;
  readonly repeats: Map<string, number>;
  readonly pureRepeats: Map<string, number>;
}

function createRepeatTracker(): RepeatTracker {
  return {
    seenKeys: new Map(),
    tableWriteSeq: new Map(),
    repeats: new Map(),
    pureRepeats: new Map(),
  };
}

function trackRepeats(
  tracker: RepeatTracker,
  statement: StatementRecord,
  sql: string,
  seq: number,
): void {
  const scopeKey = `${statement.request ?? ""}`;
  for (const table of sqlWriteTables(sql)) {
    tracker.tableWriteSeq.set(`${scopeKey}\0${table}`, seq);
  }
  if (statement.paramHash === undefined) return;
  const key = `${scopeKey} ${statement.paramHash} ${sql}`;
  const previousSeq = tracker.seenKeys.get(key);
  tracker.seenKeys.set(key, seq);
  if (previousSeq === undefined) return;
  tracker.repeats.set(sql, (tracker.repeats.get(sql) ?? 0) + 1);
  if (!isReadOnlySelect(sql)) return;
  const dirtied = sqlReadTables(sql).some(
    (table) =>
      (tracker.tableWriteSeq.get(`${scopeKey}\0${table}`) ?? 0) > previousSeq,
  );
  if (!dirtied) {
    tracker.pureRepeats.set(sql, (tracker.pureRepeats.get(sql) ?? 0) + 1);
  }
}

function group(
  label: string,
  statements: readonly StatementRecord[],
  paramHashes: boolean,
  limit: number,
): StatementGroup {
  const bySql = new Map<string, number>();
  const requestScopes = new Set<number>();
  const txSet = new Set<number>();
  const lockedTxs = new Set<number>();
  const tracker = createRepeatTracker();
  let txStatements = 0;
  let lockHoldStatements = 0;

  for (const [index, statement] of statements.entries()) {
    const sql = normalizeSql(statement.sql);
    bySql.set(sql, (bySql.get(sql) ?? 0) + 1);
    if (statement.request !== undefined) requestScopes.add(statement.request);
    if (statement.tx !== undefined) {
      txSet.add(statement.tx);
      txStatements += 1;
      if (lockedTxs.has(statement.tx)) lockHoldStatements += 1;
      else if (isLockStatement(sql)) lockedTxs.add(statement.tx);
    }
    trackRepeats(tracker, statement, sql, index + 1);
  }

  return {
    label,
    statements: statements.length,
    requestScopes: requestScopes.size,
    txStatements,
    transactions: txSet.size,
    lockHoldStatements,
    top: ranked(bySql, limit),
    sameKeyRepeats: paramHashes ? ranked(tracker.repeats, limit) : null,
    pureReadRepeats: paramHashes ? ranked(tracker.pureRepeats, limit) : null,
  };
}

function sumCounts(counts: readonly StatementCount[] | null): number | null {
  return counts ? counts.reduce((sum, item) => sum + item.count, 0) : null;
}

function maxScopeCount(
  scopeIds: ReadonlySet<number>,
  countsByRequest: ReadonlyMap<number, number>,
): number {
  let max = 0;
  for (const id of scopeIds) {
    const count = countsByRequest.get(id) ?? 0;
    if (count > max) max = count;
  }
  return max;
}

function summarizeRoutes(
  statements: readonly StatementRecord[],
  requestScopes: ReadonlyMap<number, RequestScopeRecord>,
  paramHashes: boolean,
): RouteStatementSummary[] {
  if (requestScopes.size === 0) return [];
  const scopesByRoute = new Map<string, Set<number>>();
  const statementsByRoute = new Map<string, StatementRecord[]>();
  const countsByRequest = new Map<number, number>();
  for (const [scopeId, meta] of requestScopes) {
    const key = `${meta.method} ${meta.route}`;
    const set = scopesByRoute.get(key) ?? new Set<number>();
    set.add(scopeId);
    scopesByRoute.set(key, set);
  }
  for (const statement of statements) {
    if (statement.request === undefined) continue;
    const meta = requestScopes.get(statement.request);
    if (!meta) continue;
    const key = `${meta.method} ${meta.route}`;
    const list = statementsByRoute.get(key);
    if (list) list.push(statement);
    else statementsByRoute.set(key, [statement]);
    countsByRequest.set(
      statement.request,
      (countsByRequest.get(statement.request) ?? 0) + 1,
    );
  }
  return [...scopesByRoute]
    .map(([route, scopeIds]) => {
      const analyzed = group(
        route,
        statementsByRoute.get(route) ?? [],
        paramHashes,
        100,
      );
      return {
        route,
        requests: scopeIds.size,
        statements: analyzed.statements,
        txStatements: analyzed.txStatements,
        lockHoldStatements: analyzed.lockHoldStatements,
        maxPerRequest: maxScopeCount(scopeIds, countsByRequest),
        sameKeyRepeats: sumCounts(analyzed.sameKeyRepeats),
        pureReadRepeats: sumCounts(analyzed.pureReadRepeats),
        topRepeat:
          analyzed.pureReadRepeats?.[0] ?? analyzed.sameKeyRepeats?.[0] ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.statements - a.statements ||
        b.requests - a.requests ||
        (a.route < b.route ? -1 : a.route > b.route ? 1 : 0),
    );
}

interface ParsedRecords {
  readonly statements: StatementRecord[];
  readonly requestScopes: Map<number, RequestScopeRecord>;
  readonly markers: {
    readonly label: string;
    readonly requests: number;
    readonly start: number;
    readonly end: number;
    readonly exactWindow: boolean;
  }[];
  readonly truncated: boolean;
}

function collectRecords(records: readonly CaptureRecord[]): ParsedRecords {
  const statements: StatementRecord[] = [];
  const openStarts = new Map<string, number[]>();
  const requestScopes = new Map<number, RequestScopeRecord>();
  const markers: ParsedRecords["markers"] = [];
  let truncated = false;
  for (const record of records) {
    if ("truncated" in record) {
      truncated = true;
    } else if ("phaseStart" in record) {
      const stack = openStarts.get(record.phaseStart) ?? [];
      stack.push(statements.length);
      openStarts.set(record.phaseStart, stack);
    } else if ("phaseEnd" in record) {
      const matchedStart = openStarts.get(record.phaseEnd)?.pop();
      markers.push({
        label: record.phaseEnd,
        requests: record.requests,
        start: matchedStart ?? markers.at(-1)?.end ?? 0,
        end: statements.length,
        exactWindow: matchedStart !== undefined,
      });
    } else if ("requestScope" in record) {
      requestScopes.set(record.requestScope, record);
    } else {
      statements.push(record);
    }
  }
  return { statements, requestScopes, markers, truncated };
}

/** Summarizes a capture; `limit` caps each ranked list. */
export function summarizeCapture(
  records: readonly CaptureRecord[],
  limit = 10,
): StatementSummary {
  const { statements, requestScopes, markers, truncated } =
    collectRecords(records);
  const paramHashes = statements.some(
    (statement) => statement.paramHash !== undefined,
  );
  const byLabel = new Map<string, StatementRecord[]>();
  for (const statement of statements) {
    const list = byLabel.get(statement.label);
    if (list) list.push(statement);
    else byLabel.set(statement.label, [statement]);
  }
  const overall = group("", statements, false, limit);
  return {
    statements: statements.length,
    truncated,
    paramHashes,
    txStatements: overall.txStatements,
    transactions: overall.transactions,
    lockHoldStatements: overall.lockHoldStatements,
    top: overall.top,
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
      exactWindow: marker.exactWindow,
    })),
    routes: summarizeRoutes(statements, requestScopes, paramHashes),
  };
}

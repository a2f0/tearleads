import type {
  EpochBaselineRow,
  EpochCanariesMetrics,
  EpochCanaryEntry,
  EpochInventoryMetrics,
  EpochPlansMetrics,
  EpochRealtimeRow,
  EpochReloadRow,
  EpochRotationRow,
  EpochScenarioEntry,
  EpochScenariosMetrics,
} from "./schema";
import {
  requireArray,
  requireBoolean,
  requireFiniteNumber,
  requireNullableFiniteNumber,
  requireNullableString,
  requireObject,
  requireRealtimePass,
  requireString,
  requireStringArray,
} from "./validate";

export function parseInventorySection(
  raw: unknown,
  path: string,
): EpochInventoryMetrics {
  const inv = requireObject(raw, `${path} inventory`);
  const pg = requireObject(
    Reflect.get(inv, "postgres"),
    `${path} inventory.postgres`,
  );
  const sq = requireObject(
    Reflect.get(inv, "sqlite"),
    `${path} inventory.sqlite`,
  );
  const oa = requireObject(
    Reflect.get(inv, "openapi"),
    `${path} inventory.openapi`,
  );
  const ca = requireObject(
    Reflect.get(inv, "canaries"),
    `${path} inventory.canaries`,
  );
  return {
    postgres: {
      tables: requireFiniteNumber(pg, "tables", path),
      columns: requireFiniteNumber(pg, "columns", path),
      indexes: requireFiniteNumber(pg, "indexes", path),
      migrations: requireFiniteNumber(pg, "migrations", path),
      duplicateIndexes: requireFiniteNumber(pg, "duplicateIndexes", path),
      unreadTables: requireFiniteNumber(pg, "unreadTables", path),
      unreadColumns: requireFiniteNumber(pg, "unreadColumns", path),
    },
    sqlite: {
      totalTables: requireFiniteNumber(sq, "totalTables", path),
      sdkTables: requireFiniteNumber(sq, "sdkTables", path),
      appProjectionTables: requireFiniteNumber(sq, "appProjectionTables", path),
      columns: requireFiniteNumber(sq, "columns", path),
      indexes: requireFiniteNumber(sq, "indexes", path),
      duplicateIndexes: requireFiniteNumber(sq, "duplicateIndexes", path),
      unreadTables: requireFiniteNumber(sq, "unreadTables", path),
      unreadColumns: requireFiniteNumber(sq, "unreadColumns", path),
    },
    openapi: {
      paths: requireFiniteNumber(oa, "paths", path),
      operations: requireFiniteNumber(oa, "operations", path),
      distinctResponseFields: requireFiniteNumber(
        oa,
        "distinctResponseFields",
        path,
      ),
      unreadResponseFieldLeads: requireFiniteNumber(
        oa,
        "unreadResponseFieldLeads",
        path,
      ),
      unreadFields: requireStringArray(oa, "unreadFields", path),
    },
    canaries: {
      budgetAssertions: requireFiniteNumber(ca, "budgetAssertions", path),
      driftedPhases: requireFiniteNumber(ca, "driftedPhases", path),
      maxHeadroom: requireFiniteNumber(ca, "maxHeadroom", path),
      totalHeadroom: requireFiniteNumber(ca, "totalHeadroom", path),
    },
  };
}

function parseCanaryEntry(
  raw: unknown,
  path: string,
  idx: number,
): EpochCanaryEntry {
  const row = requireObject(raw, `${path} canaries.byCanary[${idx}]`);
  return {
    canary: requireString(row, "canary", path),
    wallMs: requireFiniteNumber(row, "wallMs", path),
    requests: requireNullableFiniteNumber(row, "requests", path),
    requestBytes: requireNullableFiniteNumber(row, "requestBytes", path),
    responseBytes: requireNullableFiniteNumber(row, "responseBytes", path),
    redundantBytes: requireNullableFiniteNumber(row, "redundantBytes", path),
    exactHeadRereads: requireNullableFiniteNumber(
      row,
      "exactHeadRereads",
      path,
    ),
    apiStatements: requireNullableFiniteNumber(row, "apiStatements", path),
    apiTxStatements: requireNullableFiniteNumber(row, "apiTxStatements", path),
    apiPureReadRepeats: requireNullableFiniteNumber(
      row,
      "apiPureReadRepeats",
      path,
    ),
    clientSqlStatements: requireNullableFiniteNumber(
      row,
      "clientSqlStatements",
      path,
    ),
    clientSqlMaxHoldMs: requireNullableFiniteNumber(
      row,
      "clientSqlMaxHoldMs",
      path,
    ),
  };
}

function parseTopApiRoutes(c: Record<string, unknown>, path: string) {
  return requireArray(c, "topApiRoutes", path).map((r, i) => {
    const row = requireObject(r, `${path} topApiRoutes[${i}]`);
    return {
      route: requireString(row, "route", path),
      requests: requireFiniteNumber(row, "requests", path),
      statements: requireFiniteNumber(row, "statements", path),
      txStatements: requireFiniteNumber(row, "txStatements", path),
      lockHoldStatements: requireFiniteNumber(row, "lockHoldStatements", path),
      pureReadRepeats: requireNullableFiniteNumber(
        row,
        "pureReadRepeats",
        path,
      ),
    };
  });
}

function parseTopClientQueries(c: Record<string, unknown>, path: string) {
  return requireArray(c, "topClientQueries", path).map((r, i) => {
    const row = requireObject(r, `${path} topClientQueries[${i}]`);
    return {
      sql: requireString(row, "sql", path),
      count: requireFiniteNumber(row, "count", path),
      durationMs: requireFiniteNumber(row, "durationMs", path),
    };
  });
}

export function parseCanariesSection(
  raw: unknown,
  path: string,
): EpochCanariesMetrics {
  const c = requireObject(raw, `${path} canaries`);
  const num = (field: string) => requireFiniteNumber(c, field, path);
  const opt = (field: string) => requireNullableFiniteNumber(c, field, path);
  return {
    canaryCount: num("canaryCount"),
    wallMs: num("wallMs"),
    requests: opt("requests"),
    requestBytes: opt("requestBytes"),
    responseBytes: opt("responseBytes"),
    redundantBytes: opt("redundantBytes"),
    echoBytes: opt("echoBytes"),
    redeliveredBytes: opt("redeliveredBytes"),
    reDownloadedUploadBytes: opt("reDownloadedUploadBytes"),
    exactHeadRereads: opt("exactHeadRereads"),
    manifestCitations: opt("manifestCitations"),
    wsHints: num("wsHints"),
    apiStatements: opt("apiStatements"),
    apiTxStatements: opt("apiTxStatements"),
    apiLockHoldStatements: opt("apiLockHoldStatements"),
    apiSameKeyRepeats: opt("apiSameKeyRepeats"),
    apiPureReadRepeats: opt("apiPureReadRepeats"),
    clientSqlStatements: opt("clientSqlStatements"),
    clientSqlInLock: opt("clientSqlInLock"),
    clientSqlDurationMs: opt("clientSqlDurationMs"),
    clientSqlMutations: opt("clientSqlMutations"),
    clientSqlTxControls: opt("clientSqlTxControls"),
    clientSqlMaxHoldMs: opt("clientSqlMaxHoldMs"),
    clientSqlMaxWaitMs: opt("clientSqlMaxWaitMs"),
    topApiRoutes: parseTopApiRoutes(c, path),
    topClientQueries: parseTopClientQueries(c, path),
    byCanary: requireArray(c, "byCanary", path).map((r, i) =>
      parseCanaryEntry(r, path, i),
    ),
  };
}

function parseScenarioEntry(
  raw: unknown,
  path: string,
  idx: number,
): EpochScenarioEntry {
  const row = requireObject(raw, `${path} scenarios.byScenario[${idx}]`);
  return {
    scenario: requireString(row, "scenario", path),
    wallMs: requireFiniteNumber(row, "wallMs", path),
    requests: requireFiniteNumber(row, "requests", path),
    conflicts: requireFiniteNumber(row, "conflicts", path),
    requestBytes: requireFiniteNumber(row, "requestBytes", path),
    responseBytes: requireFiniteNumber(row, "responseBytes", path),
    apiStatements: requireNullableFiniteNumber(row, "apiStatements", path),
    pureReadRepeats: requireNullableFiniteNumber(row, "pureReadRepeats", path),
    clientSqlStatements: requireNullableFiniteNumber(
      row,
      "clientSqlStatements",
      path,
    ),
  };
}

export function parseScenariosSection(
  raw: unknown,
  path: string,
): EpochScenariosMetrics {
  const s = requireObject(raw, `${path} scenarios`);
  return {
    scenarioCount: requireFiniteNumber(s, "scenarioCount", path),
    wallMs: requireFiniteNumber(s, "wallMs", path),
    requests: requireFiniteNumber(s, "requests", path),
    conflicts: requireFiniteNumber(s, "conflicts", path),
    requestBytes: requireFiniteNumber(s, "requestBytes", path),
    responseBytes: requireFiniteNumber(s, "responseBytes", path),
    apiStatements: requireNullableFiniteNumber(s, "apiStatements", path),
    pureReadRepeats: requireNullableFiniteNumber(s, "pureReadRepeats", path),
    clientSqlStatements: requireNullableFiniteNumber(
      s,
      "clientSqlStatements",
      path,
    ),
    byScenario: requireArray(s, "byScenario", path).map((r, i) =>
      parseScenarioEntry(r, path, i),
    ),
  };
}

export function parsePlansSection(
  raw: unknown,
  path: string,
): EpochPlansMetrics {
  const p = requireObject(raw, `${path} plans`);
  return {
    inspected: requireFiniteNumber(p, "inspected", path),
    planned: requireFiniteNumber(p, "planned", path),
    skipped: requireFiniteNumber(p, "skipped", path),
    seqScanQueries: requireFiniteNumber(p, "seqScanQueries", path),
    sortQueries: requireFiniteNumber(p, "sortQueries", path),
    materializeQueries: requireFiniteNumber(p, "materializeQueries", path),
    flagged: requireArray(p, "flagged", path).map((r, i) => {
      const row = requireObject(r, `${path} plans.flagged[${i}]`);
      return {
        count: requireFiniteNumber(row, "count", path),
        warnings: requireStringArray(row, "warnings", path),
        sqlPrefix: requireString(row, "sqlPrefix", path),
      };
    }),
  };
}

export function parseReloadSection(
  raw: unknown,
  path: string,
): readonly EpochReloadRow[] {
  if (!Array.isArray(raw)) throw new Error(`${path} reload must be an array.`);
  return raw.map((r, i) => {
    const row = requireObject(r, `${path} reload[${i}]`);
    return {
      documents: requireFiniteNumber(row, "documents", path),
      folders: requireFiniteNumber(row, "folders", path),
      reload: requireString(row, "reload", path),
      medianRequests: requireFiniteNumber(row, "medianRequests", path),
      medianSettledMs: requireFiniteNumber(row, "medianSettledMs", path),
      medianApiStatements: requireFiniteNumber(
        row,
        "medianApiStatements",
        path,
      ),
      medianClientStatements: requireFiniteNumber(
        row,
        "medianClientStatements",
        path,
      ),
    };
  });
}

export function parseRealtimeSection(
  raw: unknown,
  path: string,
): readonly EpochRealtimeRow[] {
  if (!Array.isArray(raw))
    throw new Error(`${path} realtime must be an array.`);
  return raw.map((r, i) => {
    const row = requireObject(r, `${path} realtime[${i}]`);
    return {
      size: requireFiniteNumber(row, "size", path),
      pass: requireRealtimePass(row, path),
      medianDurationMs: requireFiniteNumber(row, "medianDurationMs", path),
      medianCpuMs: requireFiniteNumber(row, "medianCpuMs", path),
      statements: requireFiniteNumber(row, "statements", path),
      roundTrips: requireFiniteNumber(row, "roundTrips", path),
      rows: requireFiniteNumber(row, "rows", path),
      bytesReturned: requireFiniteNumber(row, "bytesReturned", path),
    };
  });
}

export function parseRotationsSection(
  raw: unknown,
  path: string,
): readonly EpochRotationRow[] {
  if (!Array.isArray(raw))
    throw new Error(`${path} rotations must be an array.`);
  return raw.map((r, i) => {
    const row = requireObject(r, `${path} rotations[${i}]`);
    return {
      phase: requireString(row, "phase", path),
      rotations: requireFiniteNumber(row, "rotations", path),
      depth: requireFiniteNumber(row, "depth", path),
      medianWallMs: requireFiniteNumber(row, "medianWallMs", path),
      medianRequests: requireFiniteNumber(row, "medianRequests", path),
      maxConflicts: requireFiniteNumber(row, "maxConflicts", path),
      medianPgStatements: requireFiniteNumber(row, "medianPgStatements", path),
      medianLocalSqlCalls: requireFiniteNumber(
        row,
        "medianLocalSqlCalls",
        path,
      ),
    };
  });
}

export function parseBaselinesSection(
  raw: unknown,
  path: string,
): readonly EpochBaselineRow[] {
  if (!Array.isArray(raw))
    throw new Error(`${path} baselines must be an array.`);
  return raw.map((r, i) => {
    const row = requireObject(r, `${path} baselines[${i}]`);
    return {
      phase: requireString(row, "phase", path),
      sizeMiB: requireFiniteNumber(row, "sizeMiB", path),
      race: requireBoolean(row, "race", path),
      baselineMode: requireNullableString(row, "baselineMode", path),
      medianWallMs: requireFiniteNumber(row, "medianWallMs", path),
      medianRequests: requireFiniteNumber(row, "medianRequests", path),
      maxConflicts: requireFiniteNumber(row, "maxConflicts", path),
      medianPgStatements: requireFiniteNumber(row, "medianPgStatements", path),
      medianLocalSqlCalls: requireFiniteNumber(
        row,
        "medianLocalSqlCalls",
        path,
      ),
      peakRssDeltaMiB: requireFiniteNumber(row, "peakRssDeltaMiB", path),
    };
  });
}

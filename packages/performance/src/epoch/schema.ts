/**
 * Committed Epoch 2 performance ledger schema.
 *
 * Raw JSON/JSONL captures stay private under `.test_files/performance/`.
 * Epoch snapshots store only normalized, secret-free numeric and structural
 * metrics under `packages/performance/results/epoch-2/` so longitudinal
 * improvements, regressions, and cross-dimension tradeoffs can be analyzed
 * across revisions and pull requests.
 */

export const EPOCH_SCHEMA_VERSION = 1 as const;
export const CURRENT_EPOCH = 2 as const;

export type EpochEntryKind = "baseline" | "checkpoint" | "final";

export interface EpochRuntimeInfo {
  readonly bun: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpu: string | null;
}

export interface EpochManifestEntry {
  readonly id: string;
  readonly seq: number;
  readonly label: string;
  readonly kind: EpochEntryKind;
  readonly recordedAt: string;
  readonly revision: string;
  readonly dirty: boolean;
  readonly pr?: number;
  readonly issues: readonly number[];
  readonly snapshotFile: string;
  readonly notes?: string;
}

export interface EpochManifest {
  readonly schemaVersion: typeof EPOCH_SCHEMA_VERSION;
  readonly epoch: typeof CURRENT_EPOCH;
  readonly title: string;
  readonly startedAt: string;
  readonly description: string;
  readonly entries: readonly EpochManifestEntry[];
}

export interface EpochInventoryMetrics {
  readonly postgres: {
    readonly tables: number;
    readonly columns: number;
    readonly indexes: number;
    readonly migrations: number;
    readonly duplicateIndexes: number;
    readonly unreadTables: number;
    readonly unreadColumns: number;
  };
  readonly sqlite: {
    readonly totalTables: number;
    readonly sdkTables: number;
    readonly appProjectionTables: number;
    readonly columns: number;
    readonly indexes: number;
    readonly duplicateIndexes: number;
    readonly unreadTables: number;
    readonly unreadColumns: number;
  };
  readonly openapi: {
    readonly paths: number;
    readonly operations: number;
    readonly distinctResponseFields: number;
    readonly unreadResponseFieldLeads: number;
    readonly unreadFields: readonly string[];
  };
  readonly canaries: {
    readonly budgetAssertions: number;
    readonly driftedPhases: number;
    readonly maxHeadroom: number;
    readonly totalHeadroom: number;
  };
}

export interface EpochApiRouteMetrics {
  readonly route: string;
  readonly requests: number;
  readonly statements: number;
  readonly txStatements: number;
  readonly lockHoldStatements: number;
  readonly pureReadRepeats: number | null;
}

export interface EpochClientQueryMetrics {
  readonly sql: string;
  readonly count: number;
  readonly durationMs: number;
}

export interface EpochCanaryEntry {
  readonly canary: string;
  readonly wallMs: number;
  readonly requests: number | null;
  readonly requestBytes: number | null;
  readonly responseBytes: number | null;
  readonly redundantBytes: number | null;
  readonly exactHeadRereads: number | null;
  readonly apiStatements: number | null;
  readonly apiTxStatements: number | null;
  readonly apiPureReadRepeats: number | null;
  readonly clientSqlStatements: number | null;
  readonly clientSqlMaxHoldMs: number | null;
}

export interface EpochCanariesMetrics {
  readonly canaryCount: number;
  readonly wallMs: number;
  readonly requests: number | null;
  readonly requestBytes: number | null;
  readonly responseBytes: number | null;
  readonly redundantBytes: number | null;
  readonly echoBytes: number | null;
  readonly redeliveredBytes: number | null;
  readonly reDownloadedUploadBytes: number | null;
  readonly exactHeadRereads: number | null;
  readonly manifestCitations: number | null;
  readonly wsHints: number;
  readonly apiStatements: number | null;
  readonly apiTxStatements: number | null;
  readonly apiLockHoldStatements: number | null;
  readonly apiSameKeyRepeats: number | null;
  readonly apiPureReadRepeats: number | null;
  readonly clientSqlStatements: number | null;
  readonly clientSqlInLock: number | null;
  readonly clientSqlDurationMs: number | null;
  readonly clientSqlMutations: number | null;
  readonly clientSqlTxControls: number | null;
  readonly clientSqlMaxHoldMs: number | null;
  readonly clientSqlMaxWaitMs: number | null;
  readonly topApiRoutes: readonly EpochApiRouteMetrics[];
  readonly topClientQueries: readonly EpochClientQueryMetrics[];
  readonly byCanary: readonly EpochCanaryEntry[];
}

export interface EpochScenarioEntry {
  readonly scenario: string;
  readonly wallMs: number;
  readonly requests: number;
  readonly conflicts: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly apiStatements: number | null;
  readonly pureReadRepeats: number | null;
  readonly clientSqlStatements: number | null;
}

export interface EpochScenariosMetrics {
  readonly scenarioCount: number;
  readonly wallMs: number;
  readonly requests: number;
  readonly conflicts: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly apiStatements: number | null;
  readonly pureReadRepeats: number | null;
  readonly clientSqlStatements: number | null;
  readonly byScenario: readonly EpochScenarioEntry[];
}

export interface EpochPlansMetrics {
  readonly inspected: number;
  readonly planned: number;
  readonly skipped: number;
  readonly seqScanQueries: number;
  readonly sortQueries: number;
  readonly materializeQueries: number;
  readonly flagged: readonly {
    readonly count: number;
    readonly warnings: readonly string[];
    readonly sqlPrefix: string;
  }[];
}

export interface EpochReloadRow {
  readonly documents: number;
  readonly folders: number;
  readonly reload: string;
  readonly medianRequests: number;
  readonly medianSettledMs: number;
  readonly medianApiStatements: number;
  readonly medianClientStatements: number;
}

export interface EpochRealtimeRow {
  readonly size: number;
  readonly pass: "declaration" | "revalidation";
  readonly medianDurationMs: number;
  readonly medianCpuMs: number;
  readonly statements: number;
  readonly roundTrips: number;
  readonly rows: number;
  readonly bytesReturned: number;
}

export interface EpochRotationRow {
  readonly phase: string;
  readonly rotations: number;
  readonly depth: number;
  readonly medianWallMs: number;
  readonly medianRequests: number;
  readonly maxConflicts: number;
  readonly medianPgStatements: number;
  readonly medianLocalSqlCalls: number;
}

export interface EpochBaselineRow {
  readonly phase: string;
  readonly sizeMiB: number;
  readonly race: boolean;
  readonly baselineMode: string | null;
  readonly medianWallMs: number;
  readonly medianRequests: number;
  readonly maxConflicts: number;
  readonly medianPgStatements: number;
  readonly medianLocalSqlCalls: number;
  readonly peakRssDeltaMiB: number;
}

export interface EpochSnapshot {
  readonly schemaVersion: typeof EPOCH_SCHEMA_VERSION;
  readonly epoch: typeof CURRENT_EPOCH;
  readonly id: string;
  readonly label: string;
  readonly kind: EpochEntryKind;
  readonly recordedAt: string;
  readonly revision: string;
  readonly dirty: boolean;
  readonly pr?: number;
  readonly issues: readonly number[];
  readonly runtime: EpochRuntimeInfo;
  readonly notes?: string;
  readonly inventory?: EpochInventoryMetrics;
  readonly canaries?: EpochCanariesMetrics;
  readonly scenarios?: EpochScenariosMetrics;
  readonly plans?: EpochPlansMetrics;
  readonly reload?: readonly EpochReloadRow[];
  readonly realtime?: readonly EpochRealtimeRow[];
  readonly rotations?: readonly EpochRotationRow[];
  readonly baselines?: readonly EpochBaselineRow[];
}

import {
  LOCAL_SCHEMA_BASELINE,
  type LocalSchemaMigration,
  type LocalSchemaStep,
  localSchemaSteps,
} from "./localSchemaMigrations";

/**
 * Where a local database stands against this build's migrations, read from
 * its `local_schema_migrations` ledger before any table ensure runs.
 */
export type LocalSchemaState =
  /** No user tables yet: ensures create the current shape, so every step is recorded without running. */
  | {
      readonly status: "fresh";
      readonly record: ReadonlyArray<LocalSchemaStep>;
    }
  /** User tables but no ledger: written before migrations began, so it is at the baseline. */
  | {
      readonly status: "legacy";
      readonly record: ReadonlyArray<LocalSchemaStep>;
      readonly pending: ReadonlyArray<LocalSchemaMigration>;
    }
  | {
      readonly status: "behind";
      readonly version: number;
      readonly pending: ReadonlyArray<LocalSchemaMigration>;
    }
  | { readonly status: "current"; readonly version: number }
  /** Written by a newer build; opening it here could corrupt it. */
  | {
      readonly status: "ahead";
      readonly version: number;
      readonly supported: number;
    }
  /** The ledger does not describe this build's history. */
  | { readonly status: "diverged"; readonly reason: string };

function readStep(
  row: Readonly<Record<string, unknown>>,
): LocalSchemaStep | null {
  const { name, version } = row;
  if (typeof name !== "string" || !Number.isSafeInteger(version)) return null;
  return { name, version: Number(version) };
}

/** Parses ledger rows; null when any row is malformed. */
export function parseLocalSchemaLedger(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
): LocalSchemaStep[] | null {
  const steps: LocalSchemaStep[] = [];
  for (const row of rows) {
    const step = readStep(row);
    if (!step) return null;
    steps.push(step);
  }
  return steps.sort((left, right) => left.version - right.version);
}

function ledgerGap(ledger: ReadonlyArray<LocalSchemaStep>): string | null {
  for (const [index, step] of ledger.entries()) {
    const expected = LOCAL_SCHEMA_BASELINE.version + index;
    if (step.version !== expected) {
      return `the ledger records version ${step.version} where ${expected} belongs`;
    }
  }
  return null;
}

export function classifyLocalSchema(input: {
  readonly ledger: ReadonlyArray<LocalSchemaStep> | null;
  readonly hasUserTables: boolean;
  readonly migrations: ReadonlyArray<LocalSchemaMigration>;
}): LocalSchemaState {
  const { ledger, migrations } = input;
  const steps = localSchemaSteps(migrations);
  const supported = steps.at(-1)?.version ?? LOCAL_SCHEMA_BASELINE.version;
  if (ledger === null) {
    return { status: "diverged", reason: "the ledger has a malformed row" };
  }
  if (ledger.length === 0) {
    return input.hasUserTables
      ? {
          status: "legacy",
          record: [LOCAL_SCHEMA_BASELINE],
          pending: migrations,
        }
      : { status: "fresh", record: steps };
  }
  const gap = ledgerGap(ledger);
  if (gap) return { status: "diverged", reason: gap };
  const version = ledger.at(-1)?.version ?? LOCAL_SCHEMA_BASELINE.version;
  if (version > supported) return { status: "ahead", version, supported };
  for (const [index, step] of ledger.entries()) {
    const expected = steps[index];
    if (expected?.name !== step.name) {
      return {
        status: "diverged",
        reason: `version ${step.version} is ${step.name} here but ${expected?.name ?? "unknown"} in this build`,
      };
    }
  }
  if (version === supported) return { status: "current", version };
  return {
    status: "behind",
    version,
    pending: migrations.filter((migration) => migration.version > version),
  };
}

/** The error a state that cannot be opened raises, or null. */
export function localSchemaStateError(state: LocalSchemaState): Error | null {
  if (state.status === "ahead") {
    return new Error(
      `Local database schema version ${state.version} is newer than this app supports (${state.supported}); update the app before opening it`,
    );
  }
  if (state.status === "diverged") {
    return new Error(
      `Local database schema history does not match this app: ${state.reason}`,
    );
  }
  return null;
}

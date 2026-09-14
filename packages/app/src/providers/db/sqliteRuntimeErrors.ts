// Losing the whole local database is the most destructive automatic action the
// client takes. `LogProvider.logError` forwards only real `Error`s to
// diagnostics, so each stage of that recovery mints one here — with the SQLite
// failure that triggered it as `cause`, and a stack rooted in the lifecycle
// rather than in the worker client that raised the original error.

type UnreadableDatabaseRecoveryStage =
  // The persisted database cannot be decrypted with the resolved key; its OPFS
  // files are being wiped and the database recreated.
  | "wiping"
  // The wipe itself failed, so the app surfaces an error instead of a recreate.
  | "wipe-failed"
  // The recreated database came back unreadable too: an unstable key, not a
  // one-off eviction, so recovery stops rather than looping.
  | "still-unreadable";

function describeStage(
  stage: UnreadableDatabaseRecoveryStage,
  dbName: string,
): string {
  switch (stage) {
    case "wiping":
      return `Database is unreadable with the resolved cipher key; wiping and recreating ${dbName}.`;
    case "wipe-failed":
      return `Failed to wipe the unreadable database ${dbName}; surfacing error.`;
    case "still-unreadable":
      return `Database ${dbName} is still unreadable after recreate; surfacing error.`;
  }
}

export class UnreadableDatabaseRecoveryError extends Error {
  readonly stage: UnreadableDatabaseRecoveryStage;

  constructor(
    stage: UnreadableDatabaseRecoveryStage,
    dbName: string,
    options?: { cause?: unknown },
  ) {
    super(describeStage(stage, dbName), options);
    this.name = "UnreadableDatabaseRecoveryError";
    this.stage = stage;
  }
}

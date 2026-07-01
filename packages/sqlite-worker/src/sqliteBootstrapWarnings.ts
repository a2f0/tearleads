import type { Sqlite3Static } from "@tearleads/sqlite-instance";

const AUTO_OPFS_VFS_WARNING = "Ignoring inability to install OPFS sqlite3_vfs:";
const AUTO_OPFS_VFS_IGNORED_REASONS = [
  "Missing SharedArrayBuffer and/or Atomics",
  "The OPFS sqlite3_vfs cannot run in the main thread",
];

function isIgnorableAutoOpfsVfsWarning(args: readonly unknown[]): boolean {
  const message = args[1];

  return (
    args[0] === AUTO_OPFS_VFS_WARNING &&
    typeof message === "string" &&
    AUTO_OPFS_VFS_IGNORED_REASONS.some((reason) => message.includes(reason))
  );
}

function sqliteApiConfigWithFilteredWarnings(
  existingConfigValue: unknown,
): object {
  const existingConfig =
    typeof existingConfigValue === "object" && existingConfigValue !== null
      ? existingConfigValue
      : undefined;
  const existingWarn = existingConfig
    ? Reflect.get(existingConfig, "warn")
    : undefined;

  const warn = (...args: unknown[]) => {
    if (isIgnorableAutoOpfsVfsWarning(args)) {
      return;
    }

    if (typeof existingWarn === "function") {
      Reflect.apply(existingWarn, existingConfig ?? globalThis, args);
      return;
    }

    console.warn(...args);
  };

  return Object.assign(Object.create(null), existingConfig, { warn });
}

function restoreSqliteApiConfig(previousConfigValue: unknown): void {
  if (previousConfigValue === undefined) {
    Reflect.deleteProperty(globalThis, "sqlite3ApiConfig");
    return;
  }

  Reflect.set(globalThis, "sqlite3ApiConfig", previousConfigValue);
}

export async function loadSqlite3WithFilteredWarnings(): Promise<Sqlite3Static> {
  const previousConfigValue: unknown = Reflect.get(
    globalThis,
    "sqlite3ApiConfig",
  );
  const filteredConfig =
    sqliteApiConfigWithFilteredWarnings(previousConfigValue);

  Reflect.set(globalThis, "sqlite3ApiConfig", filteredConfig);

  try {
    const { default: sqlite3InitModule } = await import(
      "@tearleads/sqlite-instance/jswasm/sqlite3.mjs"
    );
    return await sqlite3InitModule();
  } finally {
    // The SQLite bootstrap deletes sqlite3ApiConfig after consuming it. Restore
    // only if initialization failed before that handoff.
    if (Reflect.get(globalThis, "sqlite3ApiConfig") === filteredConfig) {
      restoreSqliteApiConfig(previousConfigValue);
    }
  }
}

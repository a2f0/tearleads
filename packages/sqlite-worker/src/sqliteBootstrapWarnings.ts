import type { Sqlite3Static } from "@symcrypt/sqlite-instance";

export const AUTO_OPFS_VFS_WARNING =
  "Ignoring inability to install OPFS sqlite3_vfs:";
const AUTO_OPFS_VFS_IGNORED_REASONS = [
  "Missing SharedArrayBuffer and/or Atomics",
  "The OPFS sqlite3_vfs cannot run in the main thread",
];
const AUTO_OPFS_VFS_WARN_FILTER_INSTALLED = Symbol.for(
  "symcrypt.sqliteWorker.autoOpfsVfsWarnFilterInstalled",
);

function warningText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "object" && value !== null) {
    const message = Reflect.get(value, "message");
    if (typeof message === "string") {
      return message;
    }
  }

  try {
    return String(value);
  } catch {
    return "[Object]";
  }
}

function hasIgnoredAutoOpfsVfsReason(message: string): boolean {
  return AUTO_OPFS_VFS_IGNORED_REASONS.some((reason) =>
    message.includes(reason),
  );
}

export function isIgnorableAutoOpfsVfsWarning(
  args: readonly unknown[],
): boolean {
  if (args.length === 0) {
    return false;
  }

  const firstMessage = warningText(args[0]);
  const fullMessage = args.map(warningText).join(" ");

  return (
    (firstMessage === AUTO_OPFS_VFS_WARNING ||
      firstMessage.includes(AUTO_OPFS_VFS_WARNING)) &&
    hasIgnoredAutoOpfsVfsReason(fullMessage)
  );
}

export function installSqliteBootstrapWarningFilter(): void {
  if (
    Reflect.get(console, AUTO_OPFS_VFS_WARN_FILTER_INSTALLED) === true ||
    typeof console.warn !== "function"
  ) {
    return;
  }

  const originalWarn = console.warn;
  const filteredWarn: typeof console.warn = (...args) => {
    if (isIgnorableAutoOpfsVfsWarning(args)) {
      return;
    }

    Reflect.apply(originalWarn, console, args);
  };

  Reflect.set(console, "warn", filteredWarn);
  Reflect.set(console, AUTO_OPFS_VFS_WARN_FILTER_INSTALLED, true);
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
      "@symcrypt/sqlite-instance/jswasm/sqlite3.mjs"
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

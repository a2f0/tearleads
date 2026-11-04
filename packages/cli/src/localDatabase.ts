import type { ExecSqlClientLike } from "@tearleads/client-sdk/sqlite";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";

// Outside a browser SQLite cannot install its OPFS storage and warns with a
// stack trace on every start; memory storage never needs it.
const OPFS_INSTALL_WARNING = /^Ignoring inability to install .*opfs/iu;

export function isOpfsInstallWarning(args: readonly unknown[]): boolean {
  // SQLite passes the VFS name as its own argument for some variants.
  const text = args.filter((arg) => typeof arg === "string").join(" ");
  return typeof args[0] === "string" && OPFS_INSTALL_WARNING.test(text);
}

let warningFilterInstalled = false;

// SQLite installs its OPFS variants asynchronously and may warn after
// `initDatabase` resolves, so the filter stays for the life of the process.
function installOpfsInstallWarningFilter(): void {
  if (warningFilterInstalled) return;
  warningFilterInstalled = true;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (!isOpfsInstallWarning(args)) Reflect.apply(warn, console, args);
  };
}

// Memory-only for now: every command starts from an empty local database and
// pulls what it needs. The random key only encrypts this process's memory.
export async function openLocalDatabase() {
  installOpfsInstallWarningFilter();
  const database = await initDatabase({
    dbName: `/${crypto.randomUUID()}.db`,
    cipher: "chacha20",
    key: crypto.randomUUID(),
    persistence: "memory",
  });
  const client: ExecSqlClientLike = {
    exec: async (options) => ({
      rows: execDatabaseStatement(database, options),
    }),
  };
  return { client, close: () => database.close() };
}

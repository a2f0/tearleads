import type { SQLiteRuntime } from "@symcrypt/client-sdk/sqlite";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";

const SQLITE_RUNTIME_RESET_TIMEOUT_MS = 1_000;

export type ReusableSQLiteRuntime = SQLiteRuntime & { renewClient(): void };
export type SQLiteRuntimeResetMode = "close" | "delete";

export class SQLiteRuntimeResetError extends Error {
  constructor(
    readonly mode: SQLiteRuntimeResetMode | "renew",
    cause: unknown,
  ) {
    const detail = unknownErrorMessage(cause);
    super(`SQLite runtime ${mode} failed; worker terminated: ${detail}`);
    this.name = "SQLiteRuntimeResetError";
  }
}

export function canReuseSQLiteRuntime(
  enabled: boolean,
  runtime: SQLiteRuntime | null,
): runtime is ReusableSQLiteRuntime {
  return enabled && typeof runtime?.renewClient === "function";
}

export function logSQLiteRuntimeReuseUnavailable(
  enabled: boolean,
  runtime: SQLiteRuntime | null,
  log: (message: string) => void,
): void {
  if (enabled && runtime && typeof runtime.renewClient !== "function") {
    log(
      "Database worker reuse was requested, but the live runtime no longer supports renewClient; terminating it instead.",
    );
  }
}

function timeoutError(mode: SQLiteRuntimeResetMode): Error {
  return new Error(
    `database ${mode} timed out after ${SQLITE_RUNTIME_RESET_TIMEOUT_MS}ms`,
  );
}

export async function resetReusableSQLiteRuntimeDatabase(
  runtime: ReusableSQLiteRuntime,
  mode: SQLiteRuntimeResetMode,
  timeoutMs = SQLITE_RUNTIME_RESET_TIMEOUT_MS,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const request =
      mode === "delete" ? runtime.client.delete() : runtime.client.close();
    await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              timeoutMs === SQLITE_RUNTIME_RESET_TIMEOUT_MS
                ? timeoutError(mode)
                : new Error(`database ${mode} timed out after ${timeoutMs}ms`),
            ),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    runtime.terminateNow();
    throw new SQLiteRuntimeResetError(mode, error);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function renewReusableSQLiteRuntime(
  runtime: ReusableSQLiteRuntime,
): void {
  try {
    runtime.renewClient();
  } catch (error) {
    runtime.terminateNow();
    throw new SQLiteRuntimeResetError("renew", error);
  }
}

export function releaseSQLiteRuntime(runtime: SQLiteRuntime): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      try {
        runtime.terminateNow();
      } finally {
        resolve();
      }
    };

    timeoutId = setTimeout(finish, SQLITE_RUNTIME_RESET_TIMEOUT_MS);
    try {
      runtime.client.close().then(finish, finish);
    } catch {
      finish();
    }
  });
}

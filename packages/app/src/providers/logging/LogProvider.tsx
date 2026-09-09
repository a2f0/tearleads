import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { AppDiagnostics } from "../../host/AppDiagnostics";

type LogLevel = "error" | "info";
const MAX_LOG_ENTRIES = 1000;

interface LogEntry {
  id: string;
  level: LogLevel;
  timestamp: number;
  message: string;
}

let nextLogId = 0;

interface LogContextValue {
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
}

const LogEntriesContext = createContext<ReadonlyArray<LogEntry> | null>(null);
const LogActionsContext = createContext<LogContextValue | null>(null);

function formatLogCause(cause: unknown): string {
  return String(cause);
}

export function LogProvider({
  children,
  diagnostics,
}: PropsWithChildren<{
  diagnostics?: AppDiagnostics | undefined;
}>) {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const appendEntry = useCallback((level: LogLevel, message: string) => {
    const entry: LogEntry = {
      id: String(nextLogId++),
      level,
      timestamp: Date.now(),
      message,
    };
    setEntries((prev) => {
      const nextEntries = [...prev, entry];
      return nextEntries.length > MAX_LOG_ENTRIES
        ? nextEntries.slice(-MAX_LOG_ENTRIES)
        : nextEntries;
    });
  }, []);

  const log = useCallback(
    (message: string) => {
      appendEntry("info", message);
    },
    [appendEntry],
  );

  const logError = useCallback(
    (message: string | Error, cause?: unknown) => {
      const formattedMessage = String(message);
      const detail = cause === undefined ? "" : `: ${formatLogCause(cause)}`;
      appendEntry("error", `${formattedMessage}${detail}`);
      try {
        // String logs can contain decrypted content. Only actual Error objects
        // reach the adapter, which discards messages and keeps code locations.
        diagnostics?.addBreadcrumb({ area: "app", action: "error" });
        const error =
          cause instanceof Error
            ? cause
            : message instanceof Error
              ? message
              : null;
        if (error)
          diagnostics?.captureError(error, { area: "app", source: "log" });
      } catch {
        // Keep local logging usable when remote diagnostics fail.
      }
    },
    [appendEntry, diagnostics],
  );

  const actions = useMemo(() => ({ log, logError }), [log, logError]);

  return (
    <LogActionsContext.Provider value={actions}>
      <LogEntriesContext.Provider value={entries}>
        {children}
      </LogEntriesContext.Provider>
    </LogActionsContext.Provider>
  );
}

export function useLog(): LogContextValue {
  const ctx = useContext(LogActionsContext);
  if (!ctx) {
    throw new Error("useLog must be used within a LogProvider.");
  }
  return ctx;
}

export function useLogEntries(): ReadonlyArray<LogEntry> {
  const entries = useContext(LogEntriesContext);
  if (!entries)
    throw new Error("useLogEntries must be used within a LogProvider.");
  return entries;
}

export function useOptionalLogActions() {
  return useContext(LogActionsContext);
}

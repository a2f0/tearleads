import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type LogLevel = "error" | "info";

interface LogEntry {
  id: string;
  level: LogLevel;
  timestamp: number;
  message: string;
}

let nextLogId = 0;

interface LogContextValue {
  entries: ReadonlyArray<LogEntry>;
  log: (message: string) => void;
  logError: (message: string, cause?: unknown) => void;
}

const LogContext = createContext<LogContextValue | null>(null);

function formatLogCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "string") {
    return cause;
  }

  return String(cause);
}

export function LogProvider({ children }: PropsWithChildren) {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const appendEntry = useCallback((level: LogLevel, message: string) => {
    setEntries((prev) => [
      ...prev,
      { id: String(nextLogId++), level, timestamp: Date.now(), message },
    ]);
  }, []);

  const log = useCallback(
    (message: string) => {
      appendEntry("info", message);
    },
    [appendEntry],
  );

  const logError = useCallback(
    (message: string, cause?: unknown) => {
      const detail = cause === undefined ? "" : `: ${formatLogCause(cause)}`;
      appendEntry("error", `${message}${detail}`);
    },
    [appendEntry],
  );

  const value = useMemo(
    () => ({ entries, log, logError }),
    [entries, log, logError],
  );

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
}

export function useLog(): LogContextValue {
  const ctx = useContext(LogContext);
  if (!ctx) {
    throw new Error("useLog must be used within a LogProvider.");
  }
  return ctx;
}

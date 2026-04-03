import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

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
  entries: ReadonlyArray<LogEntry>;
  log: (message: string) => void;
  logError: (message: string | Error, cause?: unknown) => void;
}

const LogContext = createContext<LogContextValue | null>(null);

function formatLogCause(cause: unknown): string {
  return String(cause);
}

export function LogProvider({ children }: PropsWithChildren) {
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

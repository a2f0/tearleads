import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export interface LogEntry {
  timestamp: number;
  message: string;
}

interface LogContextValue {
  entries: ReadonlyArray<LogEntry>;
  log: (message: string) => void;
}

const LogContext = createContext<LogContextValue | null>(null);

export function LogProvider({ children }: PropsWithChildren) {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const log = useCallback((message: string) => {
    setEntries((prev) => [...prev, { timestamp: Date.now(), message }]);
  }, []);

  const value = useMemo(() => ({ entries, log }), [entries, log]);

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
}

export function useLog(): LogContextValue {
  const ctx = useContext(LogContext);
  if (!ctx) {
    throw new Error("useLog must be used within a LogProvider.");
  }
  return ctx;
}

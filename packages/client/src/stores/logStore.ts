/**
 * Log store for capturing application logs and errors.
 * Used by the HUD to display recent activity.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
  details: string | undefined;
}

const MAX_LOGS = 100;
const DEDUPE_WINDOW_MS = 100;

class LogStore {
  private logs: LogEntry[] = [];
  private listeners: Set<() => void> = new Set();

  addLog(level: LogLevel, message: string, details?: string): void {
    const now = Date.now();
    const recentLog = this.logs[0];

    if (
      recentLog &&
      recentLog.level === level &&
      recentLog.message === message &&
      now - recentLog.timestamp.getTime() < DEDUPE_WINDOW_MS
    ) {
      return;
    }

    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      level,
      message,
      details
    };

    this.logs.unshift(entry);

    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(0, MAX_LOGS);
    }

    this.notifyListeners();
  }

  info(message: string, details?: string): void {
    this.addLog('info', message, details);
  }

  warn(message: string, details?: string): void {
    this.addLog('warn', message, details);
  }

  error(message: string, details?: string): void {
    this.addLog('error', message, details);
  }

  debug(message: string, details?: string): void {
    this.addLog('debug', message, details);
  }

  getRecentLogs(count = 20): LogEntry[] {
    return this.logs.slice(0, count);
  }

  getAllLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
    this.notifyListeners();
  }

  getLogCount(): number {
    return this.logs.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const logStore = new LogStore();

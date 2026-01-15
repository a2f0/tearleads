import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { type LogEntry, logStore } from '@/stores/logStore';

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-destructive',
  warn: 'text-warning',
  info: 'text-info',
  debug: 'text-muted-foreground'
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function LogsTab() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLogs(logStore.getRecentLogs(20));

    const unsubscribe = logStore.subscribe(() => {
      setLogs(logStore.getRecentLogs(20));
    });

    return unsubscribe;
  }, []);

  const handleClear = () => {
    logStore.clearLogs();
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (logs.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
        No logs yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground text-xs">
          {logs.length} log{logs.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={handleClear}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Clear logs"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {logs.map((log) => (
          <div
            key={log.id}
            className="rounded border bg-muted/30 px-2 py-1 font-mono text-xs"
          >
            <div
              className={cn(
                'flex items-start gap-2',
                log.details && 'cursor-pointer'
              )}
              {...(log.details && {
                onClick: () => toggleExpand(log.id),
                role: 'button',
                tabIndex: 0,
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleExpand(log.id);
                  }
                }
              })}
            >
              <span className="text-muted-foreground">
                {formatTime(log.timestamp)}
              </span>
              <span
                className={cn(
                  'w-12 shrink-0 font-medium uppercase',
                  LEVEL_COLORS[log.level]
                )}
              >
                {log.level}
              </span>
              <span className="flex-1 break-words">{log.message}</span>
            </div>
            {log.details && expandedId === log.id && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-muted-foreground text-xs">
                {log.details}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

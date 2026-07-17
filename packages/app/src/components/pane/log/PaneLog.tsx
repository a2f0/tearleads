import { useLog } from "../../../providers/logging/LogProvider";

export interface PaneLogEntry {
  id: string;
  level: "error" | "info";
  timestamp: number;
  message: string;
}

interface PaneLogProps {
  trailingEntries?: readonly PaneLogEntry[];
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Renders one log entry as the single line the pane displays.
 *
 * Shared with the System Monitor's support report so a pasted log is quoted
 * exactly as the Logs tab shows it, rather than in a second, drifting format.
 */
export function formatPaneLogLine(entry: PaneLogEntry): string {
  const level = entry.level === "error" ? "ERROR: " : "";
  return `[${formatTimestamp(entry.timestamp)}] ${level}${entry.message}`;
}

export function PaneLog({ trailingEntries = [] }: PaneLogProps) {
  const { entries: logEntries } = useLog();
  const entries = [...logEntries, ...trailingEntries];

  return (
    <div className="pane-log">
      {entries.map((entry) => (
        <div key={entry.id}>{formatPaneLogLine(entry)}</div>
      ))}
    </div>
  );
}

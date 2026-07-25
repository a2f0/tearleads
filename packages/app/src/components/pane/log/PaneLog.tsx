import { useLog } from "../../../providers/logging/LogProvider";

export interface PaneLogEntry {
  id: string;
  level: "error" | "info";
  timestamp: number;
  message: string;
}

interface PaneLogProps {
  hideSubsecondPrecision?: boolean;
  trailingEntries?: readonly PaneLogEntry[];
}

function formatTimestamp(ts: number, includeMilliseconds = true): string {
  const d = new Date(ts);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  if (!includeMilliseconds) {
    return `${hours}:${minutes}:${seconds}`;
  }
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function formatPaneLogBody(entry: PaneLogEntry): string {
  return `${entry.level === "error" ? "ERROR: " : ""}${entry.message}`;
}

/**
 * Formats the full-fidelity line used by the System Monitor support report.
 * The visible System Monitor log intentionally omits milliseconds, while the
 * copied report retains them for precise troubleshooting.
 */
export function formatPaneLogLine(entry: PaneLogEntry): string {
  return `[${formatTimestamp(entry.timestamp)}] ${formatPaneLogBody(entry)}`;
}

export function PaneLog({
  hideSubsecondPrecision = false,
  trailingEntries = [],
}: PaneLogProps) {
  const { entries: logEntries } = useLog();
  const entries = [...logEntries, ...trailingEntries];

  return (
    <div className="pane-log">
      {entries.map((entry) => (
        <div key={entry.id}>
          {hideSubsecondPrecision ? (
            <>
              {/* Keep only the timestamp muted so its brackets retain log color. */}
              [
              <span className="pane-log-timestamp">
                {formatTimestamp(entry.timestamp, false)}
              </span>
              {"] "}
              {formatPaneLogBody(entry)}
            </>
          ) : (
            formatPaneLogLine(entry)
          )}
        </div>
      ))}
    </div>
  );
}

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

export function PaneLog({ trailingEntries = [] }: PaneLogProps) {
  const { entries: logEntries } = useLog();
  const entries = [...logEntries, ...trailingEntries];

  return (
    <div className="pane-log">
      {entries.map((entry) => (
        <div key={entry.id}>
          [{formatTimestamp(entry.timestamp)}]{" "}
          {entry.level === "error" ? "ERROR: " : ""}
          {entry.message}
        </div>
      ))}
    </div>
  );
}

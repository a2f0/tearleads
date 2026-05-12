import { useLog } from "../../providers/logging/LogProvider";

interface PaneLogEntry {
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
  const time = d.toLocaleTimeString();
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return time.replace(/(\d{2})([ \u202f](?:AM|PM))/i, `$1.${ms}$2`);
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

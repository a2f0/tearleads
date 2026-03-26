import { useLog } from "../../logging/LogProvider";

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString();
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return time.replace(/(\d{2})([ \u202f](?:AM|PM))/i, `$1.${ms}$2`);
}

export function PaneLog() {
  const { entries: logEntries } = useLog();

  return (
    <div className="pane-log">
      {logEntries.map((entry) => (
        <div key={entry.id}>
          [{formatTimestamp(entry.timestamp)}] {entry.message}
        </div>
      ))}
    </div>
  );
}

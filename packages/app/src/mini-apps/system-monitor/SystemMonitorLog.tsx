import { PaneLog } from "../../components/pane/log/PaneLog";
import { useSystemMonitorBootLogEntries } from "./useSystemMonitorLogEntries";

export function SystemMonitorLog() {
  const trailingEntries = useSystemMonitorBootLogEntries();

  return <PaneLog trailingEntries={trailingEntries} />;
}

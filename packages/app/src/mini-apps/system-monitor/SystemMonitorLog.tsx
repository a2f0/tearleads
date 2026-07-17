import { PaneLog } from "../../components/pane/PaneLog";
import { useSystemMonitorBootLogEntries } from "./useSystemMonitorLogEntries";

export function SystemMonitorLog() {
  const trailingEntries = useSystemMonitorBootLogEntries();

  return <PaneLog trailingEntries={trailingEntries} />;
}

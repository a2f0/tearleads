import { PaneLog } from "../../../shell/pane/log/PaneLog";
import { useSystemMonitorBootLogEntries } from "./useSystemMonitorLogEntries";

export function SystemMonitorLog() {
  const trailingEntries = useSystemMonitorBootLogEntries();

  return <PaneLog hideSubsecondPrecision trailingEntries={trailingEntries} />;
}

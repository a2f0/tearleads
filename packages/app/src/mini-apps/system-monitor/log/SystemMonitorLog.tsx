import { useClearLog } from "../../../providers/logging/LogProvider";
import { PaneLog } from "../../../shell/pane/log/PaneLog";
import { useSystemMonitorClearAction } from "../useSystemMonitorClearAction";
import { useSystemMonitorBootLogEntries } from "./useSystemMonitorLogEntries";

export function SystemMonitorLog() {
  const trailingEntries = useSystemMonitorBootLogEntries();

  return <PaneLog hideSubsecondPrecision trailingEntries={trailingEntries} />;
}

/**
 * The System Monitor window's Logs tab: the log plus its toolbar Clear logs.
 * The pinned monitor renders the bare log, outside any window toolbar.
 */
export function SystemMonitorLogTab() {
  const clear = useClearLog();
  useSystemMonitorClearAction({
    id: "system-monitor-clear-logs",
    label: "Clear logs",
    onClear: clear,
  });

  return <SystemMonitorLog />;
}

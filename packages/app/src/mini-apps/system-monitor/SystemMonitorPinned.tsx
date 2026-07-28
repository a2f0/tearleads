import { PaneStatus } from "../../components/pane/status/PaneStatus";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { SystemMonitorLog } from "./SystemMonitorLog";
import { useSystemMonitor } from "./SystemMonitorProvider";

// When pinned, the monitor renders inline as the direct children of .pane-main
// — status on top (flex:1) and the log below — exactly as the home screen did
// before the monitor was extracted. A fragment (no extra wrapper) preserves the
// existing flex layout.
export function SystemMonitorPinned() {
  const { isPinned } = useSystemMonitor();
  if (!isPinned) {
    return null;
  }

  return (
    <LocalKeyringUnlockGate
      appName="System Monitor"
      requireLocalIdentity={false}
    >
      <PaneStatus pinned />
      <SystemMonitorLog />
    </LocalKeyringUnlockGate>
  );
}

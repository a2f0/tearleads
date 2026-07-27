import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { PowerIcon } from "@phosphor-icons/react/dist/csr/Power";
import { useMemo } from "react";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import { useAppNavigationState } from "../../navigation/AppNavigationProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useSystemMonitor } from "./SystemMonitorProvider";

const KILL_WORKER_LABEL = "Kill Worker";
const SPAWN_WORKER_LABEL = "Spawn Worker";

/**
 * SQLite worker lifecycle controls for the routed shell's app bar toolbar.
 *
 * These used to hang off the routed nav rail's system menu, which is now a pure
 * app launcher. The monitor is where the worker's status is read, so it is also
 * where the worker is killed (developer mode only, as before) and respawned.
 * Windowed mode never carried them: it reaches the same runtime through the
 * pane it already owns.
 */
export function useSystemMonitorWorkerActions(): void {
  const { killWorker, spawnWorker, status } = useDatabase();
  const { signingKeyPair } = useIdentity();
  const { isDeveloperMode } = useSystemMonitor();
  const { mode: navigationMode } = useAppNavigationState();
  const isRoutedShell = navigationMode === "routed";
  const isTerminated = status === "terminated";
  const hasWorker = signingKeyPair !== null;

  const killWorkerAction = useMemo(
    () =>
      isRoutedShell && isDeveloperMode && hasWorker && !isTerminated
        ? {
            icon: <PowerIcon aria-hidden size={14} />,
            id: "system-monitor-kill-worker",
            label: KILL_WORKER_LABEL,
            onClick: killWorker,
            priority: -20,
          }
        : null,
    [hasWorker, isDeveloperMode, isRoutedShell, isTerminated, killWorker],
  );
  const spawnWorkerAction = useMemo(
    () =>
      isRoutedShell && hasWorker && isTerminated
        ? {
            icon: <PlayIcon aria-hidden size={14} />,
            id: "system-monitor-spawn-worker",
            label: SPAWN_WORKER_LABEL,
            onClick: spawnWorker,
            priority: -20,
          }
        : null,
    [hasWorker, isRoutedShell, isTerminated, spawnWorker],
  );

  useWindowTitleBarAction(killWorkerAction);
  useWindowTitleBarAction(spawnWorkerAction);
}

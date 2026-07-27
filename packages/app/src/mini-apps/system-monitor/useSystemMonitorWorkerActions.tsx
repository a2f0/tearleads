import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { useMemo } from "react";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import { useAppNavigationState } from "../../navigation/AppNavigationProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";

const SPAWN_WORKER_LABEL = "Spawn Worker";

/**
 * SQLite worker recovery control for the routed shell's app bar toolbar.
 *
 * These used to hang off the routed nav rail's system menu, which is now a pure
 * app launcher. Keep only the recovery action for an already-terminated worker;
 * deliberately terminating a healthy worker is not routed toolbar chrome.
 */
export function useSystemMonitorWorkerActions(): void {
  const { spawnWorker, status } = useDatabase();
  const { signingKeyPair } = useIdentity();
  const { mode: navigationMode } = useAppNavigationState();
  const isRoutedShell = navigationMode === "routed";
  const isTerminated = status === "terminated";
  const hasWorker = signingKeyPair !== null;

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

  useWindowTitleBarAction(spawnWorkerAction);
}

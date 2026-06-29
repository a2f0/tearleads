import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import {
  APP_HOST_PROFILES,
  createAppHostConfig,
} from "../../src/host/AppHostConfig";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../src/mini-apps/system-monitor/systemMonitorMode";
import { withManualIdentity } from "./manualIdentityProfile";
import { MockWorker } from "./mockWorker";
import { createSharedMemoryLocalKeyringFactory } from "./sharedMemoryLocalKeyring";

// In windowed mode the System Monitor (worker status + boot log) defaults to a
// closed window. The full-app smoke tests assert on that inline status, so pin
// the monitor for both pane sides before rendering.
export function pinWindowedSystemMonitors() {
  for (const side of ["left", "right"] as const) {
    saveSystemMonitorMode(systemMonitorModeStorageKey(side), "pinned");
  }
}

type TestAppHostConfigOptions = Partial<
  Pick<
    Parameters<typeof createAppHostConfig>[0],
    "createSQLiteRuntime" | "navigationMode" | "profile"
  >
> & {
  // Keep the profile's identity autopilot on. Defaults to off so these smoke
  // tests drive the manual generate/register flow without it provisioning first.
  readonly autoProvisionIdentity?: boolean | undefined;
};

export function createTestAppHostConfig({
  autoProvisionIdentity = false,
  profile = APP_HOST_PROFILES.app,
  ...options
}: TestAppHostConfigOptions = {}) {
  return createAppHostConfig({
    apiBaseUrl: "http://localhost:3001",
    createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
    createSQLiteRuntime: () =>
      createSQLiteRuntime({
        workerConstructor: MockWorker,
      }),
    profile: autoProvisionIdentity ? profile : withManualIdentity(profile),
    wsUrl: "ws://localhost:3002",
    ...options,
  });
}

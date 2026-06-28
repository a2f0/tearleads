import {
  saveSystemMonitorDeveloperMode,
  systemMonitorDeveloperModeStorageKey,
} from "../../src/mini-apps/system-monitor/systemMonitorMode";

export function enableSystemMonitorDeveloperMode(): void {
  saveSystemMonitorDeveloperMode(
    systemMonitorDeveloperModeStorageKey(),
    "enabled",
  );
}

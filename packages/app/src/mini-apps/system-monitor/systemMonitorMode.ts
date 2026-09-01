import type { PaneSide } from "../../components/pane/dual-pane/types";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../../utils/storedPreference";

export type SystemMonitorMode = "pinned" | "windowed";
type SystemMonitorDeveloperMode = "disabled" | "enabled";

export const DEFAULT_SYSTEM_MONITOR_MODE: SystemMonitorMode = "windowed";
export const DEFAULT_SYSTEM_MONITOR_DEVELOPER_MODE: SystemMonitorDeveloperMode =
  "disabled";

const STORAGE_PREFIX = "tearleads.system-monitor";

// Pin/window choice is persisted per pane side, so the two panes remember their
// preference independently. It is intentionally not scoped per workspace: the
// monitor layout is a display preference, not per-identity data.
export function systemMonitorModeStorageKey(side: PaneSide): string {
  return `${STORAGE_PREFIX}:${side}`;
}

export function systemMonitorDeveloperModeStorageKey(): string {
  return `${STORAGE_PREFIX}:developer-mode`;
}

function isSystemMonitorMode(value: string | null): value is SystemMonitorMode {
  return value === "pinned" || value === "windowed";
}

function isSystemMonitorDeveloperMode(
  value: string | null,
): value is SystemMonitorDeveloperMode {
  return value === "disabled" || value === "enabled";
}

export function loadSystemMonitorMode(storageKey: string): SystemMonitorMode {
  return loadStoredPreference(storageKey, (stored) =>
    isSystemMonitorMode(stored) ? stored : DEFAULT_SYSTEM_MONITOR_MODE,
  );
}

export function loadSystemMonitorDeveloperMode(
  storageKey: string,
): SystemMonitorDeveloperMode {
  return loadStoredPreference(storageKey, (stored) =>
    isSystemMonitorDeveloperMode(stored)
      ? stored
      : DEFAULT_SYSTEM_MONITOR_DEVELOPER_MODE,
  );
}

export function saveSystemMonitorMode(
  storageKey: string,
  mode: SystemMonitorMode,
): void {
  saveStoredPreference(storageKey, mode);
}

export function saveSystemMonitorDeveloperMode(
  storageKey: string,
  mode: SystemMonitorDeveloperMode,
): void {
  saveStoredPreference(storageKey, mode);
}

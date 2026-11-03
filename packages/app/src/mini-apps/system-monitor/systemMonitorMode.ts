import type { PaneSide } from "../../shell/pane/dual-pane/types";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../../utils/storedPreference";

export type SystemMonitorMode = "pinned" | "windowed";

export const DEFAULT_SYSTEM_MONITOR_MODE: SystemMonitorMode = "windowed";

const STORAGE_PREFIX = "tearleads.system-monitor";

// Pin/window choice is persisted per pane side, so the two panes remember their
// preference independently. It is intentionally not scoped per workspace: the
// monitor layout is a display preference, not per-identity data.
export function systemMonitorModeStorageKey(side: PaneSide): string {
  return `${STORAGE_PREFIX}:${side}`;
}

function isSystemMonitorMode(value: string | null): value is SystemMonitorMode {
  return value === "pinned" || value === "windowed";
}

export function loadSystemMonitorMode(storageKey: string): SystemMonitorMode {
  return loadStoredPreference(storageKey, (stored) =>
    isSystemMonitorMode(stored) ? stored : DEFAULT_SYSTEM_MONITOR_MODE,
  );
}

export function saveSystemMonitorMode(
  storageKey: string,
  mode: SystemMonitorMode,
): void {
  saveStoredPreference(storageKey, mode);
}

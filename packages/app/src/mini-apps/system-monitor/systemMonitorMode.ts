import type { PaneSide } from "../../components/pane/dual-pane/types";

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

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
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
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_SYSTEM_MONITOR_MODE;
  }
  try {
    const stored = storage.getItem(storageKey);
    return isSystemMonitorMode(stored) ? stored : DEFAULT_SYSTEM_MONITOR_MODE;
  } catch {
    return DEFAULT_SYSTEM_MONITOR_MODE;
  }
}

export function loadSystemMonitorDeveloperMode(
  storageKey: string,
): SystemMonitorDeveloperMode {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_SYSTEM_MONITOR_DEVELOPER_MODE;
  }
  try {
    const stored = storage.getItem(storageKey);
    return isSystemMonitorDeveloperMode(stored)
      ? stored
      : DEFAULT_SYSTEM_MONITOR_DEVELOPER_MODE;
  } catch {
    return DEFAULT_SYSTEM_MONITOR_DEVELOPER_MODE;
  }
}

export function saveSystemMonitorMode(
  storageKey: string,
  mode: SystemMonitorMode,
): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(storageKey, mode);
  } catch {
    // Persistence is best-effort; ignore disabled storage / quota errors.
  }
}

export function saveSystemMonitorDeveloperMode(
  storageKey: string,
  mode: SystemMonitorDeveloperMode,
): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(storageKey, mode);
  } catch {
    // Persistence is best-effort; ignore disabled storage / quota errors.
  }
}

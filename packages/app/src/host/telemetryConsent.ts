import {
  loadStoredPreference,
  saveStoredPreference,
} from "../utils/storedPreference";

/** Device-wide, like the theme: one choice covers every identity here. */
export const TELEMETRY_CONSENT_STORAGE_KEY = "tearleads.telemetry";

/**
 * Whether this device shares anonymous telemetry: error reports with their
 * trail of mini-app actions, and click analytics on the hosted web origins.
 * Off until the user turns it on, during onboarding or in Settings > General.
 * Each shell's collectors read it before sending and follow its changes.
 */
export interface TelemetryConsent {
  readonly enabled: () => boolean;
  readonly setEnabled: (enabled: boolean) => void;
  /** Notifies on a change made here or in another tab of this origin. */
  readonly subscribe: (listener: () => void) => () => void;
}

function loadTelemetryConsent(): boolean {
  return loadStoredPreference(
    TELEMETRY_CONSENT_STORAGE_KEY,
    (stored) => stored === "enabled",
  );
}

/**
 * One per page, created by the shell's entry point before its collectors so
 * they start from the stored choice. Another tab's change arrives as a
 * `storage` event, heard while anything subscribes; a cleared store, as after
 * a device reset elsewhere, reads as off.
 */
export function createTelemetryConsent(): TelemetryConsent {
  const listeners = new Set<() => void>();
  let current = loadTelemetryConsent();
  const update = (next: boolean) => {
    if (next === current) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === TELEMETRY_CONSENT_STORAGE_KEY) {
      update(loadTelemetryConsent());
    }
  };
  const listening = typeof window !== "undefined";
  return {
    enabled: () => current,
    setEnabled(enabled) {
      saveStoredPreference(
        TELEMETRY_CONSENT_STORAGE_KEY,
        enabled ? "enabled" : "disabled",
      );
      update(enabled);
    },
    subscribe(listener) {
      if (listeners.size === 0 && listening) {
        // Nothing heard another tab while unsubscribed; catch up first.
        current = loadTelemetryConsent();
        window.addEventListener("storage", onStorage);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && listening) {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
  };
}

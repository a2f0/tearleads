import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRequiredContext } from "../createRequiredContext";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../launcher/storedPreference";
import type { SystemTrayDefinition } from "./systemTrayDefinition";

interface SystemTrayContextValue {
  /** The host's tray apps, in tray order. */
  definition: SystemTrayDefinition;
  /** Whether the app is visible with the user's preferences applied. */
  isEnabled: (id: string) => boolean;
  /** Turns one of the host's apps on or off, and persists the choice. */
  setEnabled: (id: string, enabled: boolean) => void;
}

const systemTrayContext = createRequiredContext<SystemTrayContextValue>(
  "useSystemTray must be used within a SystemTrayProvider",
);

function parseVisibility(stored: string | null): ReadonlyMap<string, boolean> {
  const parsed: unknown = stored === null ? null : JSON.parse(stored);
  const preferences = new Map<string, boolean>();
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (typeof entry === "string") {
        preferences.set(entry, false);
      } else if (entry && typeof entry.enabled === "string") {
        preferences.set(entry.enabled, true);
      }
    }
  }
  return preferences;
}

interface SystemTrayProviderProps<Id extends string> extends PropsWithChildren {
  /** The host's tray apps. Define it once, outside render. */
  definition: SystemTrayDefinition<Id>;
  /** Where tray visibility preferences persist in localStorage. */
  storageKey: string;
}

/**
 * Owns the system tray: the host's tray apps and which of them the user turned
 * off. {@link SystemTray} shows the ones left on, each with a context menu that
 * turns it off, and Display Properties lists every one with a switch. Mount one
 * above every taskbar that shares the choice.
 */
export function SystemTrayProvider<Id extends string>({
  children,
  definition,
  storageKey,
}: SystemTrayProviderProps<Id>) {
  const [visibility, setVisibility] = useState(() =>
    loadStoredPreference(storageKey, parseVisibility),
  );

  // Persist only what the user changed, after the change commits, so several
  // calls in one event (turning every app back on) all land.
  const persistedVisibility = useRef(visibility);
  useEffect(() => {
    if (persistedVisibility.current === visibility) {
      return;
    }
    persistedVisibility.current = visibility;
    saveStoredPreference(
      storageKey,
      // Older builds read the disabled ids and skip the opt-in records.
      JSON.stringify(
        Array.from(visibility, ([id, enabled]) =>
          enabled ? { enabled: id } : id,
        ),
      ),
    );
  }, [visibility, storageKey]);

  const defaultEnabled = useCallback(
    (id: string) =>
      (definition.apps as SystemTrayDefinition["apps"])[id]?.defaultEnabled ??
      true,
    [definition.apps],
  );

  const isEnabled = useCallback(
    (id: string) => visibility.get(id) ?? defaultEnabled(id),
    [visibility, defaultEnabled],
  );

  const setEnabled = useCallback(
    (id: string, enabled: boolean) => {
      if (!Object.hasOwn(definition.apps, id)) {
        return;
      }
      setVisibility((current) => {
        if ((current.get(id) ?? defaultEnabled(id)) === enabled) {
          return current;
        }
        const next = new Map(current);
        next.set(id, enabled);
        return next;
      });
    },
    [definition.apps, defaultEnabled],
  );

  const value = useMemo<SystemTrayContextValue>(
    () => ({ definition, isEnabled, setEnabled }),
    [definition, isEnabled, setEnabled],
  );

  return (
    <systemTrayContext.context.Provider value={value}>
      {children}
    </systemTrayContext.context.Provider>
  );
}

export const useSystemTray = systemTrayContext.useRequired;

// Non-throwing accessor: without a provider the tray shows nothing, and Display
// Properties leaves out its System Tray section.
export const useOptionalSystemTray = systemTrayContext.useOptional;

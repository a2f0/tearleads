import { type PropsWithChildren, useCallback, useMemo, useState } from "react";
import { createRequiredContext } from "../createRequiredContext";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../launcher/storedPreference";
import type { SystemTrayDefinition } from "./systemTrayDefinition";

interface SystemTrayContextValue {
  /** The host's tray apps, in tray order. */
  definition: SystemTrayDefinition;
  /** Whether the user has left the app on; every app starts on. */
  isEnabled: (id: string) => boolean;
  /** Turns one of the host's apps on or off, and persists the choice. */
  setEnabled: (id: string, enabled: boolean) => void;
}

const systemTrayContext = createRequiredContext<SystemTrayContextValue>(
  "useSystemTray must be used within a SystemTrayProvider",
);

const NONE_DISABLED: ReadonlySet<string> = new Set();

// The stored value is a JSON array of the ids the user turned off. Storing the
// off set rather than the on set lets a tray app the host adds later show up.
function parseDisabledAppIds(stored: string | null): ReadonlySet<string> {
  if (stored === null) {
    return NONE_DISABLED;
  }
  const parsed: unknown = JSON.parse(stored);
  return Array.isArray(parsed)
    ? new Set(parsed.filter((id): id is string => typeof id === "string"))
    : NONE_DISABLED;
}

interface SystemTrayProviderProps<Id extends string> extends PropsWithChildren {
  /** The host's tray apps. Define it once, outside render. */
  definition: SystemTrayDefinition<Id>;
  /** Where the apps the user turned off persist in localStorage. */
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
  const [disabledAppIds, setDisabledAppIds] = useState(() =>
    loadStoredPreference(storageKey, parseDisabledAppIds),
  );

  const isEnabled = useCallback(
    (id: string) => !disabledAppIds.has(id),
    [disabledAppIds],
  );

  const setEnabled = useCallback(
    (id: string, enabled: boolean) => {
      if (
        !Object.hasOwn(definition.apps, id) ||
        disabledAppIds.has(id) !== enabled
      ) {
        return;
      }
      const next = new Set(disabledAppIds);
      if (enabled) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setDisabledAppIds(next);
      saveStoredPreference(storageKey, JSON.stringify([...next]));
    },
    [definition.apps, disabledAppIds, storageKey],
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

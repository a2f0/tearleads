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
  if (Array.isArray(parsed)) {
    // Earlier versions stored just the ids the user disabled.
    return new Map(
      parsed
        .filter((id): id is string => typeof id === "string")
        .map((id) => [id, false]),
    );
  }
  return new Map(
    Object.entries(parsed && typeof parsed === "object" ? parsed : {}).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
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
      JSON.stringify(Object.fromEntries(visibility)),
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

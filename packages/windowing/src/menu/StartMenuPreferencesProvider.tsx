import { type PropsWithChildren, useMemo, useSyncExternalStore } from "react";
import { createRequiredContext } from "../createRequiredContext";
import type { LauncherDefinition } from "../launcher/launcherDefinition";
import { createStartMenuStore, EMPTY_MENU_OVERRIDES } from "./startMenuStore";

interface StartMenuPreferences {
  definition: LauncherDefinition;
  configurableIds: readonly string[];
  isVisible: (id: string) => boolean;
  setVisible: (id: string, visible: boolean) => void;
  reset: () => void;
}

const preferences = createRequiredContext<StartMenuPreferences>(
  "useStartMenuPreferences must be used within a StartMenuPreferencesProvider",
);

interface Props extends PropsWithChildren {
  definition: LauncherDefinition;
  storageKey: string;
}

/** Shares one host's Start menu choices across its taskbars and Settings windows. */
export function StartMenuPreferencesProvider({
  children,
  definition,
  storageKey,
}: Props) {
  // Equivalent host definitions share the same in-memory preferences, including
  // when localStorage is unavailable. Launcher display order is independent.
  const idsKey = useMemo(
    () =>
      JSON.stringify(
        Object.keys(definition.apps)
          .filter((id) => definition.apps[id]?.startMenuVisibility !== "pinned")
          .sort(),
      ),
    [definition.apps],
  );
  const configurableIds = useMemo<readonly string[]>(
    () => JSON.parse(idsKey),
    [idsKey],
  );
  const namespace = useMemo(
    () => ({ storageKey, unsaved: new Map<string, boolean | undefined>() }),
    [storageKey],
  );
  const store = useMemo(
    () =>
      createStartMenuStore(
        namespace.storageKey,
        configurableIds,
        namespace.unsaved,
      ),
    [namespace, configurableIds],
  );
  const overrides = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => EMPTY_MENU_OVERRIDES,
  );
  const value = useMemo<StartMenuPreferences>(
    () => ({
      definition,
      configurableIds,
      isVisible(id) {
        if (!configurableIds.includes(id)) return true;
        return (
          overrides.get(id) ??
          definition.apps[id]?.startMenuVisibility !== "hidden"
        );
      },
      setVisible: store.setVisible,
      reset: store.reset,
    }),
    [definition, configurableIds, overrides, store],
  );

  return (
    <preferences.context.Provider value={value}>
      {children}
    </preferences.context.Provider>
  );
}

export const useStartMenuPreferences = preferences.useRequired;
export const useOptionalStartMenuPreferences = preferences.useOptional;

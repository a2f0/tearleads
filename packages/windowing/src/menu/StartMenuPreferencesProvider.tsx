import {
  type PropsWithChildren,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRequiredContext } from "../createRequiredContext";
import {
  type LauncherDefinition,
  resolveLauncherOrder,
} from "../launcher/launcherDefinition";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../launcher/storedPreference";

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

function parseOverrides(stored: string | null): ReadonlyMap<string, boolean> {
  const parsed: unknown = stored && JSON.parse(stored);
  const overrides = new Map<string, boolean>();
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [id, visible] of Object.entries(parsed)) {
      if (typeof visible === "boolean") overrides.set(id, visible);
    }
  }
  return overrides;
}

interface Props extends PropsWithChildren {
  definition: LauncherDefinition;
  storageKey: string;
}

function StoredStartMenuPreferences({
  children,
  definition,
  storageKey,
}: Props) {
  const [overrides, setOverrides] = useState(() =>
    loadStoredPreference(storageKey, parseOverrides),
  );
  const persisted = useRef(overrides);
  useEffect(() => {
    if (persisted.current !== overrides) {
      saveStoredPreference(
        storageKey,
        JSON.stringify(Object.fromEntries(overrides)),
      );
      persisted.current = overrides;
    }
  }, [overrides, storageKey]);

  const configurableIds = useMemo(
    () =>
      resolveLauncherOrder(definition).filter(
        (id) => definition.apps[id]?.startMenuVisibility !== "pinned",
      ),
    [definition],
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
      setVisible(id, visible) {
        if (configurableIds.includes(id)) {
          setOverrides((current) => new Map(current).set(id, visible));
        }
      },
      reset() {
        setOverrides(new Map());
      },
    }),
    [definition, configurableIds, overrides],
  );

  return (
    <preferences.context.Provider value={value}>
      {children}
    </preferences.context.Provider>
  );
}

/** Shares one host's Start menu choices across its taskbars and Settings windows. */
export function StartMenuPreferencesProvider(props: Props) {
  return <StoredStartMenuPreferences key={props.storageKey} {...props} />;
}

export const useStartMenuPreferences = preferences.useRequired;
export const useOptionalStartMenuPreferences = preferences.useOptional;

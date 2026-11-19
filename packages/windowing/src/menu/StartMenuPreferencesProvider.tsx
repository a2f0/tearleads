import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
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

function readVisibility(key: string): boolean | undefined {
  return loadStoredPreference(key, (value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  });
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
  const configurableIds = useMemo(() => {
    const ids = new Set([
      ...resolveLauncherOrder(definition),
      ...Object.keys(definition.apps),
    ]);
    return [...ids].filter(
      (id) => definition.apps[id]?.startMenuVisibility !== "pinned",
    );
  }, [definition]);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const keyFor = useCallback(
    (id: string) => `${storageKey}.${id}`,
    [storageKey],
  );
  useEffect(() => {
    function restore() {
      const next = new Map<string, boolean>();
      for (const id of configurableIds) {
        const visible = readVisibility(keyFor(id));
        if (visible !== undefined) next.set(id, visible);
      }
      setOverrides(next);
    }
    function onStorage(event: StorageEvent) {
      if (event.key === null) {
        restore();
        return;
      }
      const id = configurableIds.find((id) => keyFor(id) === event.key);
      if (id === undefined) return;
      const visible = readVisibility(keyFor(id));
      setOverrides((current) => {
        const next = new Map(current);
        if (visible === undefined) next.delete(id);
        else next.set(id, visible);
        return next;
      });
    }
    restore();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [configurableIds, keyFor]);
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
          saveStoredPreference(keyFor(id), String(visible));
          setOverrides((current) => new Map(current).set(id, visible));
        }
      },
      reset() {
        for (const id of configurableIds)
          saveStoredPreference(keyFor(id), null);
        setOverrides(new Map());
      },
    }),
    [definition, configurableIds, overrides, keyFor],
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

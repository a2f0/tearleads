import {
  getLocalStorage,
  loadStoredPreference,
  saveStoredPreference,
} from "../launcher/storedPreference";

export const EMPTY_MENU_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

function readVisibility(key: string) {
  return loadStoredPreference(key, (value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  });
}

/** One preference namespace. A storage event only changes the app that was written. */
export function createStartMenuStore(
  storageKey: string,
  ids: readonly string[],
  unsaved = new Map<string, boolean | undefined>(),
) {
  // Leave a single unescaped boundary between the namespace and the app ID.
  const keyFor = (id: string) =>
    `${storageKey}.${id.replaceAll("%", "%25").replaceAll(".", "%2E")}`;
  function persist(id: string, visible: boolean | undefined) {
    const value = visible === undefined ? null : String(visible);
    if (saveStoredPreference(keyFor(id), value)) unsaved.delete(id);
    else unsaved.set(id, visible);
  }
  function readAll() {
    const next = new Map<string, boolean>();
    for (const id of ids) {
      const visible = unsaved.has(id)
        ? unsaved.get(id)
        : readVisibility(keyFor(id));
      if (visible !== undefined) next.set(id, visible);
    }
    return next;
  }
  let overrides: ReadonlyMap<string, boolean> = readAll();
  const listeners = new Set<() => void>();
  function publish(next: ReadonlyMap<string, boolean>) {
    if (
      overrides.size === next.size &&
      [...next].every(([id, value]) => overrides.get(id) === value)
    )
      return;
    overrides = next;
    for (const notify of listeners) notify();
  }
  function update(id: string, visible: boolean | undefined) {
    const next = new Map(overrides);
    if (visible === undefined) next.delete(id);
    else next.set(id, visible);
    publish(next);
  }
  function onStorage(event: StorageEvent) {
    if (event.storageArea && event.storageArea !== getLocalStorage()) return;
    if (event.key === null) {
      publish(readAll());
      return;
    }
    const id = ids.find((id) => keyFor(id) === event.key);
    // A queued storage event may predate a failed local write. The local
    // choice wins in this tab until its next successful write or reset.
    if (id !== undefined && !unsaved.has(id)) {
      update(id, readVisibility(keyFor(id)));
    }
  }
  return {
    snapshot: () => overrides,
    subscribe(notify: () => void) {
      listeners.add(notify);
      window.addEventListener("storage", onStorage);
      // Include writes between render and subscription.
      publish(readAll());
      return () => {
        listeners.delete(notify);
        if (!listeners.size) window.removeEventListener("storage", onStorage);
      };
    },
    setVisible(id: string, visible: boolean) {
      if (!ids.includes(id)) return;
      persist(id, visible);
      update(id, visible);
    },
    reset() {
      for (const id of ids) persist(id, undefined);
      publish(EMPTY_MENU_OVERRIDES);
    },
  };
}

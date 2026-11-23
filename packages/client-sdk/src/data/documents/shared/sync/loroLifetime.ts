/**
 * A lifetime is one JavaScript realm running the SDK: a browser tab or a
 * webview page load. A Loro read window it leaves behind (#3194) is an
 * orphan only once the lifetime has ended, and it counts nothing when the
 * user ended it by hiding or closing the app.
 *
 * Liveness comes from Web Locks: each lifetime holds a lock named after it
 * for as long as it runs, and the browser releases a dead realm's locks.
 * Tabs share one database through the cross-tab SQLite owner, so a live
 * tab's window must never look like an orphan. A host without Web Locks
 * treats every other lifetime as alive and never claims an orphan. The
 * command line's database is memory-only, so its windows never outlive the
 * process; a host whose database outlives its process must hold a lock or
 * mark its clean exits, or its deaths count nothing.
 */

const LOCK_PREFIX = "tearleads-loro-lifetime:";
const HIDDEN_MARKER_PREFIX = "tearleads-loro-hidden:";

/** The Web Locks surface a lifetime uses. */
export interface LifetimeLockManager {
  query(): Promise<{
    readonly held?: ReadonlyArray<{ readonly name?: string }>;
  }>;
  request(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => Promise<void>,
  ): Promise<unknown>;
}

/** The synchronous storage that keeps hidden markers (`localStorage`). */
export interface LifetimeMarkerStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

/** Reports whether the app is hidden, and every change. */
export interface LifetimeVisibility {
  hidden(): boolean;
  onChange(listener: () => void): void;
}

export interface LoroLifetimes {
  readonly id: string;
  /** Resolves once other lifetimes can see this one is alive. */
  ready(): Promise<void>;
  /** The lifetimes among `ids` known to have ended. */
  endedAmong(ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** Whether lifetime `id` ended while its app was hidden. */
  endedHidden(id: string): boolean;
  /** Drops the marker an ended lifetime left. */
  forget(id: string): void;
  /** Counts an open window, which a hidden marker then covers. */
  windowOpened(): void;
  /** Uncounts a window once its row is gone. */
  windowClosed(): void;
}

function markerKey(id: string): string {
  return `${HIDDEN_MARKER_PREFIX}${id}`;
}

function quietly<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/**
 * A lifetime over the given host surfaces. Its hidden marker is set while
 * the app is hidden and a window is open, and removed otherwise, so a death
 * while hidden leaves a marker and a closed tab without windows leaves none.
 */
export function createLoroLifetimes(host: {
  readonly id?: string | undefined;
  readonly locks?: LifetimeLockManager | undefined;
  readonly storage?: LifetimeMarkerStorage | undefined;
  readonly visibility?: LifetimeVisibility | undefined;
}): LoroLifetimes {
  const id = host.id ?? crypto.randomUUID();
  const { locks, storage, visibility } = host;
  let openWindows = 0;
  let held: Promise<void> | undefined;
  let watching = false;

  const syncMarker = () => {
    if (!storage) return;
    const hidden = visibility?.hidden() ?? false;
    quietly(() => {
      if (hidden && openWindows > 0) storage.setItem(markerKey(id), "1");
      else storage.removeItem(markerKey(id));
    }, undefined);
  };

  return {
    id,
    ready() {
      if (!locks) return Promise.resolve();
      held ??= new Promise<void>((granted, failed) => {
        locks
          .request(`${LOCK_PREFIX}${id}`, { mode: "exclusive" }, () => {
            granted();
            // Held for the rest of the lifetime.
            return new Promise<void>(() => undefined);
          })
          .catch(failed);
      });
      return held;
    },
    async endedAmong(ids) {
      if (!locks || ids.length === 0) return new Set();
      let names: Set<string>;
      try {
        const snapshot = await locks.query();
        names = new Set(
          (snapshot.held ?? []).flatMap((lock) =>
            lock.name === undefined ? [] : [lock.name],
          ),
        );
      } catch {
        return new Set();
      }
      return new Set(
        ids.filter((other) => !names.has(`${LOCK_PREFIX}${other}`)),
      );
    },
    endedHidden(other) {
      return quietly(() => storage?.getItem(markerKey(other)) === "1", false);
    },
    forget(other) {
      quietly(() => storage?.removeItem(markerKey(other)), undefined);
    },
    windowOpened() {
      if (!watching && visibility) {
        watching = true;
        visibility.onChange(syncMarker);
      }
      openWindows += 1;
      syncMarker();
    },
    windowClosed() {
      openWindows = Math.max(0, openWindows - 1);
      syncMarker();
    },
  };
}

function browserLocks(): LifetimeLockManager | undefined {
  return quietly(() => {
    if (typeof navigator !== "object") return undefined;
    const locks: LockManager | undefined = navigator.locks;
    if (
      typeof locks?.request !== "function" ||
      typeof locks.query !== "function"
    ) {
      return undefined;
    }
    const manager: LifetimeLockManager = {
      query: () => locks.query(),
      request: (name, options, callback) =>
        locks.request(name, options, callback),
    };
    return manager;
  }, undefined);
}

function browserStorage(): LifetimeMarkerStorage | undefined {
  return quietly(
    () => (typeof localStorage === "object" ? localStorage : undefined),
    undefined,
  );
}

/**
 * Hidden while the document is hidden, and from `pagehide` until a
 * `pageshow`: a closing tab fires `pagehide` even when it never reports
 * itself hidden.
 */
function browserVisibility(): LifetimeVisibility | undefined {
  if (typeof document !== "object" || typeof addEventListener !== "function") {
    return undefined;
  }
  const page = document;
  let pageHidden = false;
  return {
    hidden: () => pageHidden || page.visibilityState === "hidden",
    onChange(listener) {
      page.addEventListener("visibilitychange", listener);
      addEventListener("pagehide", () => {
        pageHidden = true;
        listener();
      });
      addEventListener("pageshow", () => {
        pageHidden = false;
        listener();
      });
    },
  };
}

/** This realm's lifetime; tests pass their own to stand for another one. */
export const processLoroLifetimes: LoroLifetimes = createLoroLifetimes({
  locks: browserLocks(),
  storage: browserStorage(),
  visibility: browserVisibility(),
});

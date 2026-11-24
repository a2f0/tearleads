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
 * opens no window and never claims an orphan. A lifetime that met a Loro
 * runtime failure anywhere counts no death: the module may be unusable. The
 * command line's database is memory-only, so its windows never outlive the
 * process; a host whose database outlives its process must hold a lock or
 * mark its clean exits, or its deaths count nothing.
 */

import {
  LORO_WINDOW_GATE_IDLE,
  type LoroWindowGate,
  type LoroWindowGateEvent,
  loroGateHolders,
  transitionLoroWindowGate,
} from "./loroWindowGate";

const LOCK_PREFIX = "tearleads-loro-lifetime:";
const HIDDEN_MARKER_PREFIX = "tearleads-loro-hidden:";
const FAILED_MARKER_PREFIX = "tearleads-loro-failed:";
const PROBE_MARKER_PREFIX = "tearleads-loro-probe:";

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
  /**
   * Resolves true once other lifetimes can see this one is alive. Resolves
   * false without Web Locks or when the lock is refused: no lifetime could
   * then tell this one's windows from orphans, so it opens none.
   */
  ready(): Promise<boolean>;
  /** The lifetimes among `ids` known to have ended. */
  endedAmong(ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** Whether lifetime `id` ended while its app was hidden. */
  endedHidden(id: string): boolean;
  /** Whether lifetime `id` met a Loro runtime failure with a window open. */
  endedFailed(id: string): boolean;
  /** Drops the markers an ended lifetime left. */
  forget(id: string): void;
  /**
   * Whether this lifetime can leave the markers that tell a death from the
   * user closing the app: it needs working storage and page visibility. A
   * window opened without them counts nothing, so a close is never charged
   * to an update.
   */
  keepsMarkers(): boolean;
  /**
   * Notes this lifetime's first Loro runtime failure, wherever it happened:
   * a window open now counts nothing if the lifetime then dies.
   */
  noteFailed(): void;
  /**
   * Notes a window whose row could not be deleted: the failure marker then
   * stands for the rest of the lifetime, so its death isolates that row's
   * updates instead of counting them.
   */
  noteUnsettledWindow(): void;
  /** Whether this lifetime holds a window on `scope`. */
  hasWindow(scope: string): boolean;
  /** How many windows this lifetime holds open. */
  openWindowCount(): number;
  /**
   * Notes a window on `scope`, which the lifetime's markers then cover,
   * once the window gate admits it (alone when `exclusive`). A wait longer
   * than the gate's limit opens it anyway, outside the gate.
   */
  openWindow(scope: string, exclusive: boolean): Promise<void>;
  /** Notes the window on `scope` gone; false when none was open. */
  closeWindow(scope: string): boolean;
}

/** How long a window waits for the gate before reading outside it. */
const GATE_WAIT_MS = 30_000;

function markerKey(prefix: string, id: string): string {
  return `${prefix}${id}`;
}

function quietly<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** This lifetime's Web Lock, and what other lifetimes' locks say. */
function lifetimeLock(
  id: string,
  lockManager: () => LifetimeLockManager | undefined,
): Pick<LoroLifetimes, "endedAmong" | "ready"> {
  let held: Promise<boolean> | undefined;
  return {
    ready() {
      const locks = lockManager();
      if (!locks) return Promise.resolve(false);
      held ??= new Promise<boolean>((settle) => {
        try {
          locks
            .request(`${LOCK_PREFIX}${id}`, { mode: "exclusive" }, () => {
              settle(true);
              // Held for the rest of the lifetime.
              return new Promise<void>(() => undefined);
            })
            .catch(() => settle(false));
        } catch {
          settle(false);
        }
      });
      return held;
    },
    async endedAmong(ids) {
      const locks = lockManager();
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
  };
}

/** The windows this lifetime holds, admitted through its window gate. */
function lifetimeWindows(gateWaitMs: number, onChange: () => void) {
  const windows = new Set<string>();
  const entering = new Map<string, { enter(): void; entered: Promise<void> }>();
  let gate: LoroWindowGate = LORO_WINDOW_GATE_IDLE;
  const moveGate = (event: LoroWindowGateEvent) => {
    gate = transitionLoroWindowGate(gate, event);
    for (const holder of loroGateHolders(gate)) entering.get(holder)?.enter();
  };
  return {
    count: () => windows.size,
    has: (scope: string) => windows.has(scope),
    open(scope: string, exclusive: boolean): Promise<void> {
      if (windows.has(scope)) return Promise.resolve();
      const pending = entering.get(scope);
      if (pending) return pending.entered;
      const { promise, resolve } = Promise.withResolvers<void>();
      const enter = () => {
        clearTimeout(timer);
        entering.delete(scope);
        windows.add(scope);
        onChange();
        resolve();
      };
      const timer = setTimeout(() => {
        // Leaves the queue and reads outside the gate: it may not count.
        moveGate({ type: "released", scope });
        enter();
      }, gateWaitMs);
      entering.set(scope, { enter, entered: promise });
      moveGate({ type: "requested", waiter: { exclusive, scope } });
      return promise;
    },
    close(scope: string): boolean {
      // A scope still waiting for the gate keeps its place.
      if (!windows.delete(scope)) return false;
      moveGate({ type: "released", scope });
      onChange();
      return true;
    },
  };
}

/**
 * A lifetime over the given host surfaces. While it holds a window, its
 * hidden marker stands while the app is hidden and its failure marker once
 * it has failed; with no window open it leaves neither, so a death while
 * hidden or after a failure leaves its marker and a closed tab leaves none.
 */
export function createLoroLifetimes(host: {
  readonly id?: string | undefined;
  /** The lock manager, or how to find it each time it is needed. */
  readonly locks?:
    | LifetimeLockManager
    | (() => LifetimeLockManager | undefined)
    | undefined;
  readonly storage?: LifetimeMarkerStorage | undefined;
  readonly visibility?: LifetimeVisibility | undefined;
  /** @internal How long a window waits for the gate; tests shorten it. */
  readonly gateWaitMs?: number | undefined;
}): LoroLifetimes {
  const id = host.id ?? crypto.randomUUID();
  const { storage, visibility } = host;
  let failed = false;
  let unsettled = false;
  let watching = false;

  const setMarker = (prefix: string, standing: boolean) => {
    quietly(() => {
      if (standing) storage?.setItem(markerKey(prefix, id), "1");
      else storage?.removeItem(markerKey(prefix, id));
    }, undefined);
  };
  const syncMarkers = () => {
    const open = windows.count() > 0 || unsettled;
    setMarker(HIDDEN_MARKER_PREFIX, open && (visibility?.hidden() ?? false));
    setMarker(FAILED_MARKER_PREFIX, open && failed);
  };
  const windows = lifetimeWindows(host.gateWaitMs ?? GATE_WAIT_MS, syncMarkers);
  const marked = (prefix: string, other: string) =>
    quietly(() => storage?.getItem(markerKey(prefix, other)) === "1", false);

  return {
    id,
    ...lifetimeLock(id, () =>
      typeof host.locks === "function" ? host.locks() : host.locks,
    ),
    endedHidden: (other) => marked(HIDDEN_MARKER_PREFIX, other),
    endedFailed: (other) => marked(FAILED_MARKER_PREFIX, other),
    forget(other) {
      quietly(() => {
        storage?.removeItem(markerKey(HIDDEN_MARKER_PREFIX, other));
        storage?.removeItem(markerKey(FAILED_MARKER_PREFIX, other));
      }, undefined);
    },
    keepsMarkers() {
      if (!storage || !visibility) return false;
      const probe = markerKey(PROBE_MARKER_PREFIX, id);
      return quietly(() => {
        storage.setItem(probe, "1");
        const kept = storage.getItem(probe) === "1";
        storage.removeItem(probe);
        return kept;
      }, false);
    },
    noteFailed() {
      failed = true;
      syncMarkers();
    },
    noteUnsettledWindow() {
      failed = true;
      unsettled = true;
      syncMarkers();
    },
    hasWindow: windows.has,
    openWindowCount: windows.count,
    openWindow(scope, exclusive) {
      if (!watching && visibility) {
        watching = true;
        visibility.onChange(syncMarkers);
      }
      return windows.open(scope, exclusive);
    },
    closeWindow: windows.close,
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

/** The page events a lifetime's visibility follows. */
export interface VisibilityPage {
  addEventListener(type: "pagehide" | "pageshow", listener: () => void): void;
  readonly document: {
    addEventListener(type: "visibilitychange", listener: () => void): void;
    readonly visibilityState: string;
  };
}

/**
 * @internal Hidden while the document is hidden, and from `pagehide` until
 * a `pageshow`: a closing tab fires `pagehide` even when it never reports
 * itself hidden.
 */
export function pageVisibility(page: VisibilityPage): LifetimeVisibility {
  let pageHidden = false;
  return {
    hidden: () => pageHidden || page.document.visibilityState === "hidden",
    onChange(listener) {
      page.document.addEventListener("visibilitychange", listener);
      page.addEventListener("pagehide", () => {
        pageHidden = true;
        listener();
      });
      page.addEventListener("pageshow", () => {
        pageHidden = false;
        listener();
      });
    },
  };
}

function browserVisibility(): LifetimeVisibility | undefined {
  if (typeof document !== "object" || typeof addEventListener !== "function") {
    return undefined;
  }
  return pageVisibility({
    addEventListener: (type, listener) => addEventListener(type, listener),
    document,
  });
}

/** This realm's lifetime; tests pass their own to stand for another one. */
export const processLoroLifetimes: LoroLifetimes = createLoroLifetimes({
  locks: browserLocks,
  storage: browserStorage(),
  visibility: browserVisibility(),
});

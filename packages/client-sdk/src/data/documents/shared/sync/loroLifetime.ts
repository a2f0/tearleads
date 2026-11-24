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
  type LoroGateWaiter,
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
  /**
   * Drops the markers an ended lifetime left, once a claim finds none of its
   * windows left in its database. A lifetime that left a window it could not
   * settle keeps them: its windows may stand in databases that claim cannot
   * see, and they must still not count its death.
   */
  forget(id: string): void;
  /**
   * Whether this lifetime can leave the markers that tell a death from the
   * user closing the app: it needs working storage and page visibility. A
   * window opened without them counts nothing, so a close is never charged
   * to an update.
   */
  keepsMarkers(): boolean;
  /**
   * Notes this lifetime's first Loro runtime failure, wherever it happened,
   * or its first read of served updates that no window covers: a window
   * open now or later counts nothing if the lifetime then dies.
   */
  noteFailed(): void;
  /**
   * Notes a window row that could not be deleted or stopped counting: the
   * failure marker then stands for the rest of the lifetime, so its death
   * isolates that row's updates instead of counting them.
   */
  noteUnsettledWindow(): void;
  /** Whether this lifetime holds window `id` open. */
  hasWindow(id: string): boolean;
  /** How many windows this lifetime holds open. */
  openWindowCount(): number;
  /**
   * Opens a window once the window gate admits it (alone when `exclusive`)
   * and resolves to its id; the lifetime's markers then cover it. A wait
   * longer than the gate's limit opens it anyway, outside the gate. Each
   * call opens a window of its own, even beside another on the same scope.
   */
  openWindow(exclusive: boolean): Promise<string>;
  /** Notes window `id` gone; false when it was not open. */
  closeWindow(id: string): boolean;
  /**
   * Admits no window until every open one has closed, or until `waitMs`
   * has passed, so a restart of the realm leaves no window behind; resolves
   * true when none was left open. Windows asked for meanwhile wait, at most
   * the gate's limit, and enter once the drain ends.
   */
  drainWindows(waitMs: number): Promise<boolean>;
}

/** How long a window waits for the gate before reading outside it. */
const GATE_WAIT_MS = 30_000;
/** How long a lifetime waits for its lock before opening no windows. */
const LOCK_WAIT_MS = 10_000;

function markerKey(prefix: string, id: string): string {
  return `${prefix}${id}`;
}

/** The failure marker's value: an unsettled lifetime's survives a claim. */
const FAILED_MARKER_VALUE = {
  failed: "1",
  unsettled: "unsettled",
} as const;

/** Whether this host can write and read back a lifetime's markers. */
function probeMarkers(
  storage: LifetimeMarkerStorage | undefined,
  visibility: LifetimeVisibility | undefined,
  id: string,
): boolean {
  if (!storage || !visibility) return false;
  const probe = markerKey(PROBE_MARKER_PREFIX, id);
  return quietly(() => {
    storage.setItem(probe, "1");
    const kept = storage.getItem(probe) === "1";
    storage.removeItem(probe);
    return kept;
  }, false);
}

/**
 * Whether a death of the lifetime may count: `failed` once it met a Loro
 * runtime failure or read served updates outside every window, `unsettled`
 * once a window row it could not settle or stop counting outlived its
 * window, which keeps the failure marker standing with no window open.
 */
type LifetimeHealth = "healthy" | "failed" | "unsettled";

type LifetimeHealthEvent = "runtimeFailed" | "windowUnsettled";

function transitionLifetimeHealth(
  health: LifetimeHealth,
  event: LifetimeHealthEvent,
): LifetimeHealth {
  switch (event) {
    case "runtimeFailed":
      return health === "unsettled" ? health : "failed";
    case "windowUnsettled":
      return "unsettled";
  }
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
  lockWaitMs: number,
): Pick<LoroLifetimes, "endedAmong" | "ready"> {
  let held: Promise<boolean> | undefined;
  return {
    ready() {
      const locks = lockManager();
      if (!locks) return Promise.resolve(false);
      held ??= new Promise<boolean>((resolve) => {
        // A request never granted (a frozen page, a stub manager) opens no
        // window rather than holding every page's sync.
        const timer = setTimeout(() => resolve(false), lockWaitMs);
        const settle = (granted: boolean) => {
          clearTimeout(timer);
          resolve(granted);
        };
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

/** A drain of the lifetime's windows, and the requests it holds back. */
interface WindowDrain {
  readonly held: LoroGateWaiter[];
  readonly settled: Promise<boolean>;
  readonly finish: (drained: boolean) => void;
}

/** The windows this lifetime holds, admitted through its window gate. */
function lifetimeWindows(gateWaitMs: number, onChange: () => void) {
  const windows = new Set<string>();
  const entering = new Map<string, () => void>();
  let gate: LoroWindowGate = LORO_WINDOW_GATE_IDLE;
  let drain: WindowDrain | null = null;
  const moveGate = (event: LoroWindowGateEvent) => {
    gate = transitionLoroWindowGate(gate, event);
    for (const holder of loroGateHolders(gate)) entering.get(holder)?.();
  };
  const request = (waiter: LoroGateWaiter) => {
    if (drain) drain.held.push(waiter);
    else moveGate({ type: "requested", waiter });
  };
  const startDrain = (waitMs: number): WindowDrain => {
    // Take every queued request out of the gate, last first, so none is
    // admitted on the way; they ask again, in order, once the drain ends.
    const held = [...gate.waiting];
    for (const waiter of [...held].reverse()) {
      moveGate({ type: "released", window: waiter.window });
    }
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const timer = setTimeout(() => started.finish(false), waitMs);
    const started: WindowDrain = {
      finish(drained) {
        if (drain !== started) return;
        clearTimeout(timer);
        drain = null;
        for (const waiter of held) request(waiter);
        resolve(drained);
      },
      held,
      settled: promise,
    };
    return started;
  };
  return {
    drain(waitMs: number): Promise<boolean> {
      if (drain) return drain.settled;
      if (windows.size === 0) return Promise.resolve(true);
      drain = startDrain(waitMs);
      return drain.settled;
    },
    count: () => windows.size,
    has: (id: string) => windows.has(id),
    open(exclusive: boolean): Promise<string> {
      const window = crypto.randomUUID();
      const { promise, resolve } = Promise.withResolvers<string>();
      const enter = () => {
        clearTimeout(timer);
        entering.delete(window);
        windows.add(window);
        onChange();
        resolve(window);
      };
      const timer = setTimeout(() => {
        // Leaves the queue and reads outside the gate: it may not count.
        const heldAt = drain?.held.findIndex((w) => w.window === window);
        if (heldAt !== undefined && heldAt >= 0) drain?.held.splice(heldAt, 1);
        moveGate({ type: "released", window });
        enter();
      }, gateWaitMs);
      entering.set(window, enter);
      request({ exclusive, window });
      return promise;
    },
    close(id: string): boolean {
      if (!windows.delete(id)) return false;
      moveGate({ type: "released", window: id });
      onChange();
      if (windows.size === 0) drain?.finish(true);
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
  /** @internal How long the lifetime waits for its lock; tests shorten it. */
  readonly lockWaitMs?: number | undefined;
}): LoroLifetimes {
  const id = host.id ?? crypto.randomUUID();
  const { storage, visibility } = host;
  let health: LifetimeHealth = "healthy";
  let markersKept: boolean | undefined;
  let watching = false;

  const setMarker = (prefix: string, value: string | null) => {
    quietly(() => {
      if (value !== null) storage?.setItem(markerKey(prefix, id), value);
      else storage?.removeItem(markerKey(prefix, id));
    }, undefined);
  };
  const failedMarker = (): string | null => {
    if (health === "unsettled") return FAILED_MARKER_VALUE.unsettled;
    if (windows.count() === 0) return null;
    return health === "failed" ? FAILED_MARKER_VALUE.failed : null;
  };
  const syncMarkers = () => {
    const open = windows.count() > 0 || health === "unsettled";
    const hidden = open && (visibility?.hidden() ?? false);
    setMarker(HIDDEN_MARKER_PREFIX, hidden ? "1" : null);
    setMarker(FAILED_MARKER_PREFIX, failedMarker());
  };
  const moveHealth = (event: LifetimeHealthEvent) => {
    health = transitionLifetimeHealth(health, event);
    syncMarkers();
  };
  const windows = lifetimeWindows(host.gateWaitMs ?? GATE_WAIT_MS, syncMarkers);
  const markerOf = (prefix: string, other: string) =>
    quietly(() => storage?.getItem(markerKey(prefix, other)) ?? null, null);

  return {
    id,
    ...lifetimeLock(
      id,
      () => (typeof host.locks === "function" ? host.locks() : host.locks),
      host.lockWaitMs ?? LOCK_WAIT_MS,
    ),
    endedHidden: (other) => markerOf(HIDDEN_MARKER_PREFIX, other) !== null,
    endedFailed: (other) => markerOf(FAILED_MARKER_PREFIX, other) !== null,
    forget(other) {
      const failed = markerOf(FAILED_MARKER_PREFIX, other);
      if (failed === FAILED_MARKER_VALUE.unsettled) return;
      quietly(() => {
        storage?.removeItem(markerKey(HIDDEN_MARKER_PREFIX, other));
        storage?.removeItem(markerKey(FAILED_MARKER_PREFIX, other));
      }, undefined);
    },
    keepsMarkers() {
      // Probed once: each write fires a storage event in every other tab.
      markersKept ??= probeMarkers(storage, visibility, id);
      return markersKept;
    },
    noteFailed: () => moveHealth("runtimeFailed"),
    noteUnsettledWindow: () => moveHealth("windowUnsettled"),
    hasWindow: windows.has,
    openWindowCount: windows.count,
    openWindow(exclusive) {
      if (!watching && visibility) {
        watching = true;
        visibility.onChange(syncMarkers);
      }
      return windows.open(exclusive);
    },
    closeWindow: windows.close,
    drainWindows: windows.drain,
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

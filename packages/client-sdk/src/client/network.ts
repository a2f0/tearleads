export type NetworkListener = (online: boolean) => void;
export type NetworkMode = "automatic" | "online" | "offline";

function defaultOnline(): boolean {
  return typeof navigator === "object" && typeof navigator.onLine === "boolean"
    ? navigator.onLine
    : true;
}

/**
 * Platform-agnostic source of connectivity status. The default browser
 * implementation reads `navigator.onLine` and the window `online`/`offline`
 * events, which is accurate on real browsers. Native shells supply their own
 * implementation backed by the OS connectivity API — most importantly the
 * Capacitor Android WebView, where `navigator.onLine` is unreliable and often
 * reports offline while the device is genuinely connected.
 *
 * The contract is deliberately small so a native adapter can satisfy it: a
 * synchronous best-known read for seeding, plus a push subscription for
 * changes. A source that can only read connectivity asynchronously returns an
 * optimistic value from {@link getOnline} and corrects it through the first
 * emission to a subscriber.
 */
export interface NetworkStatusSource {
  /**
   * Best-known connectivity, read synchronously so the SDK can seed its state
   * without waiting on an async native round-trip.
   */
  getOnline(): boolean;
  /**
   * Subscribe to connectivity changes; returns an unsubscribe function. A
   * source whose underlying read is asynchronous should emit the resolved
   * value as soon as it is known so the seeded value is corrected promptly.
   */
  subscribe(listener: NetworkListener): () => void;
  /** Release any platform resources (event handlers, native listeners). */
  dispose?(): void;
}

/**
 * The default {@link NetworkStatusSource}: `navigator.onLine` for the seed and
 * the window `online`/`offline` events for changes. Safe to construct in a
 * non-DOM context (SSR, tests) — it reports online and never registers a
 * listener when `window` is absent.
 */
export function createBrowserNetworkStatusSource(): NetworkStatusSource {
  return {
    getOnline: defaultOnline,
    subscribe(listener: NetworkListener): () => void {
      if (typeof window === "undefined") {
        return () => {};
      }
      const goOnline = () => listener(true);
      const goOffline = () => listener(false);
      window.addEventListener("online", goOnline);
      window.addEventListener("offline", goOffline);
      return () => {
        window.removeEventListener("online", goOnline);
        window.removeEventListener("offline", goOffline);
      };
    },
  };
}

function resolveOnline(mode: NetworkMode, detectedOnline: boolean): boolean {
  if (mode === "online") {
    return true;
  }

  if (mode === "offline") {
    return false;
  }

  return detectedOnline;
}

export class Network {
  private readonly listeners = new Set<NetworkListener>();
  private detectedOnlineValue: boolean;
  private modeValue: NetworkMode = "automatic";

  constructor(online: boolean = defaultOnline()) {
    this.detectedOnlineValue = online;
  }

  get online(): boolean {
    return resolveOnline(this.modeValue, this.detectedOnlineValue);
  }

  get detectedOnline(): boolean {
    return this.detectedOnlineValue;
  }

  get mode(): NetworkMode {
    return this.modeValue;
  }

  setOnline(online: boolean): void {
    const previousOnline = this.online;
    if (this.detectedOnlineValue === online) {
      return;
    }

    this.detectedOnlineValue = online;
    if (this.online !== previousOnline) {
      this.notifyListeners();
    }
  }

  setMode(mode: NetworkMode): void {
    if (this.modeValue === mode) {
      return;
    }

    this.modeValue = mode;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const online = this.online;
    for (const listener of this.listeners) {
      try {
        listener(online);
      } catch {
        // Keep one subscriber failure from blocking later subscribers.
      }
    }
  }

  subscribe = (listener: NetworkListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

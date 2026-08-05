import { createListenerSet } from "./listenerSet";
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
   * Whether this source is the authoritative device-connectivity signal. A
   * native OS-backed source (Capacitor's `@capacitor/network`, reading
   * `ConnectivityManager` / `NWPathMonitor`) sets this so the SDK treats it as
   * the sole truth for `online`: a backend request that fails to reach the
   * server then means the backend is unreachable, not that the device is
   * offline, and must not flip connectivity (see {@link Network.reportReachability}).
   * The browser fallback omits it — there `navigator.onLine` is coarse and a
   * failed fetch is the best available offline proxy, so request outcomes are
   * allowed to drive connectivity as before.
   */
  readonly authoritative?: boolean;
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
  /**
   * Optional one-line diagnostic snapshot for the support log — how the source
   * is reading connectivity (e.g. which native plugin, the raw status, the
   * WebView's `navigator.onLine`). Purely informational; a source that has
   * nothing platform-specific to report omits it.
   */
  diagnose?(): Promise<string>;
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
  private readonly listeners = createListenerSet<[boolean]>();
  private detectedOnlineValue: boolean;
  private modeValue: NetworkMode = "automatic";
  private connectivityAuthoritativeValue = false;

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
      this.listeners.notify(this.online);
    }
  }

  setMode(mode: NetworkMode): void {
    if (this.modeValue === mode) {
      return;
    }

    this.modeValue = mode;
    this.listeners.notify(this.online);
  }

  /**
   * Declares whether an authoritative device-connectivity source (a native
   * OS-backed {@link NetworkStatusSource}) is governing connectivity. When set,
   * request-outcome reachability signals ({@link reportReachability}) no longer
   * touch `online` — the source is the sole truth. The host sets this from the
   * source it injects; the browser fallback leaves it false.
   */
  setConnectivityAuthoritative(authoritative: boolean): void {
    this.connectivityAuthoritativeValue = authoritative;
  }

  /**
   * Reports the outcome of a backend request as a connectivity hint. Without an
   * authoritative source (the browser) a failed fetch is the best offline
   * signal available, so it drives `online` exactly like a detected change.
   * With an authoritative OS source, a failed request means the backend is
   * unreachable — not that the device lost its network — so this is a no-op and
   * the OS source keeps `online` truthful; the unreachable backend still
   * surfaces downstream as a sync/request failure rather than a false "offline"
   * that a native shell can never recover from (no OS `online` event fires
   * because the device never actually disconnected).
   */
  reportReachability(online: boolean): void {
    if (this.connectivityAuthoritativeValue) {
      return;
    }

    this.setOnline(online);
  }

  subscribe = (listener: NetworkListener): (() => void) =>
    this.listeners.subscribe(listener);
}

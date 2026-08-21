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
 * The contract is deliberately small so a host adapter can satisfy it: a
 * synchronous best-known read for seeding, plus a push subscription for
 * changes. A source that can only read connectivity asynchronously returns an
 * optimistic value from {@link getOnline} and corrects it through the first
 * emission to a subscriber.
 */
export interface NetworkStatusSource {
  /**
   * Whether this source continuously governs device connectivity. Browser
   * `online`/`offline` events and native OS-backed sources set this so the SDK
   * treats them as the sole source of offline transitions: a backend request
   * that fails to reach the server then means the backend is unreachable, not
   * that the device went offline, and must not stop recovery retries (see
   * {@link Network.reportReachability}). A successful backend request still
   * proves connectivity and can correct a stale offline signal. Sources that
   * omit this flag let both request outcomes act as connectivity hints, which is
   * useful for headless hosts that have no independent connectivity signal.
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
    // Keep backend failures distinct from device connectivity. If a failed
    // request flipped this source offline while the browser remained connected,
    // no later `online` event would fire and the WebSocket retry loop would stay
    // disabled after the backend recovered.
    authoritative: true,
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
   * Declares whether an independent {@link NetworkStatusSource} is governing
   * connectivity. When set, failed-request reachability signals
   * ({@link reportReachability}) no longer touch `online`; successful requests
   * may still repair a stale offline signal.
   */
  setConnectivityAuthoritative(authoritative: boolean): void {
    this.connectivityAuthoritativeValue = authoritative;
  }

  /**
   * Reports the outcome of a backend request as a connectivity hint. Without an
   * authoritative source, it drives `online` exactly like a detected change.
   * With an authoritative browser or OS source, a failed request means the
   * backend is unreachable — not that the device lost its network — so a
   * negative hint is ignored. A successful request is conclusive evidence of
   * connectivity and can repair a stale source reading. Backend failures still
   * surface downstream while connection retries remain live.
   */
  reportReachability(online: boolean): void {
    if (this.connectivityAuthoritativeValue && !online) {
      return;
    }

    this.setOnline(online);
  }

  subscribe = (listener: NetworkListener): (() => void) =>
    this.listeners.subscribe(listener);
}

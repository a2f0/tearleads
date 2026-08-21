import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { type ConnectionStatus, Network } from "@capacitor/network";
import type {
  NetworkListener,
  NetworkStatusSource,
} from "@symcrypt/client-sdk";

// @capacitor/network derives `connected` from NET_CAPABILITY_VALIDATED — Android's
// active internet-validation probe — so it reports false on networks Android has
// not validated (captive portals, some VPN / corporate / regional networks) and
// during the window before validation completes at cold start, even while the
// device has a working connection. That false-offline is precisely the bug this
// source exists to fix, so treat any active network (connectionType !== "none",
// which the plugin sets from the transport regardless of validation) as online.
// A network that is up but truly has no internet surfaces later as a sync
// failure, not as a misleading "offline".
function isConnected(status: ConnectionStatus): boolean {
  return status.connected || status.connectionType !== "none";
}

/**
 * Capacitor-backed {@link NetworkStatusSource}. Reads connectivity from
 * `@capacitor/network`, which uses the native OS connectivity API
 * (`ConnectivityManager` on Android, `NWPathMonitor` on iOS) rather than the
 * WebView's `navigator.onLine`. The Android WebView reports `navigator.onLine`
 * as `false` while the device is genuinely connected — the offline-detection
 * bug this replaces.
 *
 * Native reads are asynchronous, so `getOnline()` returns a cached value that
 * starts optimistically online and is corrected by the first `getStatus()`
 * result and every subsequent `networkStatusChange` event.
 */
export function createCapacitorNetworkStatus(): NetworkStatusSource {
  // When the native Network plugin is not registered (e.g. stripped from a
  // minified release build), @capacitor/network silently falls back to its web
  // implementation, whose getStatus() is just the WebView's `navigator.onLine`
  // — the very value that reports offline while an Android device is connected.
  // Detect that and refuse to trust it: hold the optimistic "online" seed rather
  // than let a false navigator.onLine strand the app offline. A genuinely
  // unreachable backend still surfaces as a sync/request failure, not "offline".
  const nativePlugin = Capacitor.isPluginAvailable("Network");
  let online = true;
  let disposed = false;
  const listeners = new Set<NetworkListener>();
  let handlePromise: Promise<PluginListenerHandle> | null = null;

  function update(nextOnline: boolean): void {
    // A getStatus() promise can still resolve after dispose(); ignore it so a
    // torn-down source never mutates state or notifies removed listeners.
    if (disposed || nextOnline === online) {
      return;
    }
    online = nextOnline;
    for (const listener of listeners) {
      listener(online);
    }
  }

  function ensureNativeBinding(): void {
    // Only bind when the native plugin is present. Without it, getStatus() and
    // networkStatusChange come from the web fallback (navigator.onLine), so
    // subscribing would reintroduce the false-offline; the optimistic seed holds
    // instead.
    if (handlePromise || !nativePlugin) {
      return;
    }
    // Prime the cached value from the current native status, then keep it live
    // with the change listener.
    void Network.getStatus()
      .then((status) => update(isConnected(status)))
      .catch(() => {});
    handlePromise = Network.addListener("networkStatusChange", (status) => {
      update(isConnected(status));
    });
  }

  async function readStatusText(): Promise<string> {
    try {
      const status = await Network.getStatus();
      return `connected=${status.connected} type=${status.connectionType}`;
    } catch (error) {
      return `getStatus error: ${String(error)}`;
    }
  }

  return {
    // Authoritative only on a real native platform, where getStatus() reads the
    // OS connectivity API (ConnectivityManager / NWPathMonitor) — the device's
    // true connectivity, more trustworthy than any request outcome. Marking it
    // authoritative stops a failed backend request from flipping the SDK offline
    // (which a native shell can never recover from: no OS `online` event fires
    // because the device never disconnected); an unreachable backend surfaces as
    // a sync/request failure instead. This holds even when the native plugin is
    // absent and this source pins the optimistic "online" seed (see above) —
    // that seed must not be undone by a request failure either. Not authoritative
    // in the Capacitor web dev target (getPlatform() === "web"): there this
    // factory is still injected but @capacitor/network's web implementation just
    // reads navigator.onLine, which is no better than the browser source, so a
    // failed fetch should still drive offline as it does on the web shell.
    authoritative: Capacitor.isNativePlatform(),
    getOnline: () => online,
    subscribe(listener: NetworkListener): () => void {
      listeners.add(listener);
      ensureNativeBinding();
      return () => {
        listeners.delete(listener);
      };
    },
    async diagnose(): Promise<string> {
      const navigatorOnline =
        typeof navigator === "object" ? String(navigator.onLine) : "n/a";
      return [
        `platform=${Capacitor.getPlatform()}`,
        `nativePlugin=${nativePlugin}`,
        await readStatusText(),
        `navigator.onLine=${navigatorOnline}`,
      ].join(" ");
    },
    dispose(): void {
      disposed = true;
      const pending = handlePromise;
      handlePromise = null;
      listeners.clear();
      void pending?.then((handle) => handle.remove()).catch(() => {});
    },
  };
}

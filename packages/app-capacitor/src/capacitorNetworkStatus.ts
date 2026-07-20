import type { PluginListenerHandle } from "@capacitor/core";
import { Network } from "@capacitor/network";
import type {
  NetworkListener,
  NetworkStatusSource,
} from "@tearleads/client-sdk";

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
  let online = true;
  const listeners = new Set<NetworkListener>();
  let handlePromise: Promise<PluginListenerHandle> | null = null;

  function update(nextOnline: boolean): void {
    if (nextOnline === online) {
      return;
    }
    online = nextOnline;
    for (const listener of listeners) {
      listener(online);
    }
  }

  function ensureNativeBinding(): void {
    if (handlePromise) {
      return;
    }
    // Prime the cached value from the current native status, then keep it live
    // with the change listener.
    void Network.getStatus()
      .then((status) => update(status.connected))
      .catch(() => {});
    handlePromise = Network.addListener("networkStatusChange", (status) => {
      update(status.connected);
    });
  }

  return {
    getOnline: () => online,
    subscribe(listener: NetworkListener): () => void {
      listeners.add(listener);
      ensureNativeBinding();
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      const pending = handlePromise;
      handlePromise = null;
      listeners.clear();
      void pending?.then((handle) => handle.remove()).catch(() => {});
    },
  };
}

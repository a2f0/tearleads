import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { Network } from "@capacitor/network";
import type { SubscribeConnectionRefreshFn } from "app/host/AppHostConfig";

/**
 * Treat native resumes and network-path changes as WebSocket validity
 * boundaries. Both can leave WKWebView holding an `OPEN` socket whose TCP path
 * is gone; Wi-Fi to cellular may not change the app's online boolean at all.
 */
export const subscribeCapacitorConnectionRefresh: SubscribeConnectionRefreshFn =
  (listener) => {
    let subscribed = true;
    const refresh = () => {
      if (subscribed) {
        listener();
      }
    };
    const handlePromises: Array<Promise<PluginListenerHandle>> = [
      App.addListener("resume", refresh),
      Network.addListener("networkStatusChange", refresh),
    ];

    return () => {
      subscribed = false;
      for (const handlePromise of handlePromises) {
        void handlePromise.then((handle) => handle.remove()).catch(() => {});
      }
    };
  };

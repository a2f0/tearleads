import { describe, expect, test } from "bun:test";
import { quietLogger } from "../../test/helpers/clientTestSupport";
import { Network } from "./network";
import { Tearleads } from "./Tearleads";

describe("Network reachability", () => {
  test("reportReachability drives connectivity when no authoritative source governs it", () => {
    const network = new Network(true);
    const snapshots: boolean[] = [];
    network.subscribe((online) => snapshots.push(online));

    // Without an authoritative source (the browser) a failed fetch is the best
    // offline signal available, so a reachability report drives `online`
    // exactly like a detected connectivity change.
    network.reportReachability(false);
    expect(network.online).toBe(false);
    network.reportReachability(true);
    expect(network.online).toBe(true);

    expect(snapshots).toEqual([false, true]);
  });

  test("an authoritative source makes reportReachability a no-op so a failed request cannot strand the app offline", () => {
    const network = new Network(true);
    const snapshots: boolean[] = [];
    network.subscribe((online) => snapshots.push(online));

    network.setConnectivityAuthoritative(true);
    // A backend request failing to reach the server must not flip the device
    // offline while the OS source reports it connected.
    network.reportReachability(false);
    expect(network.online).toBe(true);
    expect(snapshots).toEqual([]);

    // The OS source itself still governs connectivity through setOnline.
    network.setOnline(false);
    expect(network.online).toBe(false);
    network.setOnline(true);
    expect(network.online).toBe(true);
    expect(snapshots).toEqual([false, true]);
  });

  test("a thrown backend fetch flips offline on a browser shell but not under an authoritative source", async () => {
    const previousFetch = globalThis.fetch;
    // A WebView fetch rejected by CORS/ATS throws the same TypeError as a
    // genuine offline; the API client classifies both as kind:"network".
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      throw new TypeError("Load failed");
    }) as typeof fetch;

    try {
      // Browser default (non-authoritative): the thrown fetch flips the store
      // offline, the WebView's best available offline proxy.
      const browserSdk = new Tearleads({
        apiBaseUrl: "https://api.example.test",
        logger: quietLogger,
        online: true,
      });
      await browserSdk.session.listSessions().catch(() => undefined);
      expect(browserSdk.network.online).toBe(false);

      // Native shell: an authoritative OS source is bound, so the same thrown
      // fetch reports the backend unreachable without stranding it offline.
      const nativeSdk = new Tearleads({
        apiBaseUrl: "https://api.example.test",
        logger: quietLogger,
        online: true,
      });
      nativeSdk.network.setConnectivityAuthoritative(true);
      await nativeSdk.session.listSessions().catch(() => undefined);
      expect(nativeSdk.network.online).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

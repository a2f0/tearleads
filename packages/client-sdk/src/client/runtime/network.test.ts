import { describe, expect, test } from "bun:test";
import { createTransportFaultHarness } from "@tearleads/test-utils";
import { quietLogger } from "../../../test/helpers/clientTestSupport";
import { Tearleads } from "../../Tearleads";
import { createBrowserNetworkStatusSource, Network } from "./network";

describe("Network reachability", () => {
  test("reportReachability drives connectivity when no authoritative source governs it", () => {
    const network = new Network(true);
    const snapshots: boolean[] = [];
    network.subscribe((online) => snapshots.push(online));

    // Without an authoritative host source, a reachability report drives
    // `online` exactly like a detected connectivity change.
    network.reportReachability(false);
    expect(network.online).toBe(false);
    network.reportReachability(true);
    expect(network.online).toBe(true);

    expect(snapshots).toEqual([false, true]);
  });

  test("only an authoritative source's reading classifies API failures", () => {
    const network = new Network(true);
    // Request outcomes would make a failed call read as offline.
    expect(network.authoritativeOnline).toBeNull();
    network.setConnectivityAuthoritative(true);
    network.setOnline(false);
    expect(network.authoritativeOnline).toBe(false);
    network.setOnline(true);
    expect(network.authoritativeOnline).toBe(true);
  });

  test("the browser source owns connectivity so backend recovery retries stay live", () => {
    const source = createBrowserNetworkStatusSource();
    expect(source.authoritative).toBe(true);

    const network = new Network(source.getOnline());
    network.setConnectivityAuthoritative(source.authoritative ?? false);
    network.reportReachability(false);

    expect(network.online).toBe(source.getOnline());
  });

  test("an authoritative source ignores failures but accepts proven recovery", () => {
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
    network.reportReachability(true);
    expect(network.online).toBe(true);
    expect(snapshots).toEqual([false, true]);
  });

  test("a thrown backend fetch is only a connectivity hint without an authoritative source", async () => {
    // A WebView fetch rejected by CORS/ATS throws the same TypeError as a
    // genuine offline; the API client classifies both as kind:"network".
    const harness = createTransportFaultHarness({
      steps: ["headless", "native"].map((name) => ({
        name,
        method: "GET",
        url: "https://api.example.test/auth/sessions",
        action: { kind: "network-error", message: "Load failed" },
      })),
    });
    await harness.run(async () => {
      // An unbound/headless SDK has no independent connectivity source, so the
      // thrown fetch remains a useful offline hint.
      const headlessSdk = new Tearleads({
        apiBaseUrl: "https://api.example.test",
        logger: quietLogger,
        online: true,
      });
      await headlessSdk.session.listSessions().catch(() => undefined);
      expect(headlessSdk.network.online).toBe(false);

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
    });
    expect(harness.attempts.map((attempt) => attempt.outcome)).toEqual([
      "network-error",
      "network-error",
    ]);
  });
});

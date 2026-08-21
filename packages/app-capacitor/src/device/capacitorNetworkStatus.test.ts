import { afterEach, expect, mock, test } from "bun:test";
import type { ConnectionStatus } from "@capacitor/network";

type ChangeListener = (status: ConnectionStatus) => void;

// Mutable fixture the mocked native modules read, so each test configures the
// plugin availability and reported status before building a source.
const fixture: {
  nativePlatform: boolean;
  pluginAvailable: boolean;
  status: ConnectionStatus;
  listeners: ChangeListener[];
  removed: number;
} = {
  nativePlatform: true,
  pluginAvailable: true,
  status: { connected: false, connectionType: "cellular" },
  listeners: [],
  removed: 0,
};

const registerPlugin = () => ({});

mock.module("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => fixture.nativePlatform,
    isPluginAvailable: () => fixture.pluginAvailable,
    getPlatform: () => "android",
    registerPlugin,
  },
  registerPlugin,
}));

mock.module("@capacitor/network", () => ({
  Network: {
    getStatus: () => Promise.resolve(fixture.status),
    addListener: (_event: string, listener: ChangeListener) => {
      fixture.listeners.push(listener);
      return Promise.resolve({
        remove: () => {
          fixture.removed += 1;
          return Promise.resolve();
        },
      });
    },
  },
}));

// Imported after the module mocks so the source binds to them, not the real
// native bridge.
const { createCapacitorNetworkStatus } = await import(
  "./capacitorNetworkStatus"
);

afterEach(() => {
  fixture.nativePlatform = true;
  fixture.pluginAvailable = true;
  fixture.status = { connected: false, connectionType: "cellular" };
  fixture.listeners = [];
  fixture.removed = 0;
});

// Lets the async getStatus() promise chain resolve before assertions.
function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test("owns connectivity on native and web targets", () => {
  // On a real device getStatus() reads the OS connectivity API — the device's
  // connectivity truth — so a failed backend request must never override it (see
  // reportReachability). Authoritative regardless of native plugin availability;
  // a stripped plugin still pins the optimistic online seed.
  fixture.nativePlatform = true;
  expect(createCapacitorNetworkStatus().authoritative).toBe(true);
  fixture.pluginAvailable = false;
  expect(createCapacitorNetworkStatus().authoritative).toBe(true);

  // The web implementation also provides an independent connectivity
  // subscription. Backend failures must not overwrite it and strand retries.
  fixture.nativePlatform = false;
  fixture.pluginAvailable = true;
  expect(createCapacitorNetworkStatus().authoritative).toBe(true);
});

test("holds online and never binds the plugin when the native plugin is absent", async () => {
  fixture.pluginAvailable = false;
  fixture.status = { connected: false, connectionType: "none" };

  const source = createCapacitorNetworkStatus();
  const seen: boolean[] = [];
  source.subscribe((online) => seen.push(online));
  await flushAsync();

  // Without the native plugin, @capacitor/network's getStatus() is just
  // navigator.onLine, so no native listener is registered and the optimistic
  // online seed is held rather than trusting a possible false offline.
  expect(source.getOnline()).toBe(true);
  expect(fixture.listeners).toHaveLength(0);
  expect(seen).toEqual([]);
});

test("treats an active unvalidated network (cellular) as online", async () => {
  fixture.pluginAvailable = true;
  fixture.status = { connected: false, connectionType: "cellular" };

  const source = createCapacitorNetworkStatus();
  source.subscribe(() => {});
  await flushAsync();

  // connected=false (NET_CAPABILITY_VALIDATED not set) but an active transport
  // means the device is connected.
  expect(source.getOnline()).toBe(true);
});

test("reports offline only when there is no active connection", async () => {
  fixture.pluginAvailable = true;
  fixture.status = { connected: false, connectionType: "none" };

  const source = createCapacitorNetworkStatus();
  const seen: boolean[] = [];
  source.subscribe((online) => seen.push(online));
  await flushAsync();

  expect(source.getOnline()).toBe(false);
  expect(seen).toEqual([false]);
});

test("live networkStatusChange events update connectivity", async () => {
  fixture.pluginAvailable = true;
  fixture.status = { connected: true, connectionType: "wifi" };

  const source = createCapacitorNetworkStatus();
  source.subscribe(() => {});
  await flushAsync();
  expect(source.getOnline()).toBe(true);

  const listener = fixture.listeners[0];
  expect(listener).toBeDefined();
  listener?.({ connected: false, connectionType: "none" });
  expect(source.getOnline()).toBe(false);
});

test("diagnose reports the platform, native availability, and status", async () => {
  fixture.pluginAvailable = false;
  fixture.status = { connected: false, connectionType: "none" };

  const source = createCapacitorNetworkStatus();
  const snapshot = await source.diagnose?.();

  expect(snapshot).toContain("platform=android");
  expect(snapshot).toContain("nativePlugin=false");
  expect(snapshot).toContain("connected=false");
  expect(snapshot).toContain("type=none");
});

test("dispose removes the native listener handle", async () => {
  fixture.pluginAvailable = true;
  fixture.status = { connected: true, connectionType: "wifi" };

  const source = createCapacitorNetworkStatus();
  source.subscribe(() => {});
  await flushAsync();

  source.dispose?.();
  await flushAsync();
  expect(fixture.removed).toBe(1);
});

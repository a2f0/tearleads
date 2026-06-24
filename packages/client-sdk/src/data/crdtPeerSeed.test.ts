import { expect, test } from "bun:test";
import { getScopedPeerSeed, type PeerSeedEnvironment } from "./crdtPeerSeed";

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function seededEnvironment(
  locks: PeerSeedEnvironment["locks"],
): PeerSeedEnvironment {
  const deviceStorage = memStorage();
  const sessionStorage = memStorage();
  deviceStorage.setItem("tearleads.docs.device-seed", "DEVICE");
  sessionStorage.setItem("tearleads.docs.session-peer-seed", "SESSION");
  return { deviceStorage, sessionStorage, locks };
}

// Grants the lock immediately: this tab becomes the device-peer owner.
const grantingLocks: PeerSeedEnvironment["locks"] = {
  request: (_name, _options, callback) => Promise.resolve(callback({})),
};
// ifAvailable cannot grant the lock: another tab already owns it.
const denyingLocks: PeerSeedEnvironment["locks"] = {
  request: (_name, _options, callback) => Promise.resolve(callback(null)),
};
// The lock request itself rejects.
const rejectingLocks: PeerSeedEnvironment["locks"] = {
  request: () => Promise.reject(new Error("locks unavailable")),
};

test("uses the device-stable seed when this tab owns the device-peer lock", async () => {
  const seed = await getScopedPeerSeed(
    "docs",
    seededEnvironment(grantingLocks),
  );
  expect(seed).toBe("DEVICE");
});

test("falls back to a per-tab seed when another tab owns the lock", async () => {
  const seed = await getScopedPeerSeed("docs", seededEnvironment(denyingLocks));
  expect(seed).toBe("DEVICE:SESSION");
});

test("falls back to a per-tab seed when Web Locks are unavailable", async () => {
  const seed = await getScopedPeerSeed("docs", seededEnvironment(null));
  expect(seed).toBe("DEVICE:SESSION");
});

test("falls back to a per-tab seed when the lock request rejects", async () => {
  const seed = await getScopedPeerSeed(
    "docs",
    seededEnvironment(rejectingLocks),
  );
  expect(seed).toBe("DEVICE:SESSION");
});

test("holds the device-peer lock for the tab lifetime when granted", async () => {
  let ownerCallbackResult: unknown;
  const locks: PeerSeedEnvironment["locks"] = {
    request: (_name, _options, callback) => {
      ownerCallbackResult = callback({});
      return Promise.resolve();
    },
  };
  const seed = await getScopedPeerSeed("docs", seededEnvironment(locks));
  expect(seed).toBe("DEVICE");

  // The owner branch must keep the lock by never settling its callback promise;
  // if it settled, the browser would release the lock and another tab could
  // claim the same device peer concurrently.
  let settled = false;
  void Promise.resolve(ownerCallbackResult).then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
});

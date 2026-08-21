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
  deviceStorage.setItem("symcrypt.docs.device-seed", "DEVICE");
  sessionStorage.setItem("symcrypt.docs.session-peer-seed", "SESSION");
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

test("reuses one cached seed per scope rather than re-requesting the lock", async () => {
  let requestCount = 0;
  const locks: PeerSeedEnvironment["locks"] = {
    request: (_name, _options, callback) => {
      requestCount += 1;
      return Promise.resolve(callback({}));
    },
  };
  const environment = seededEnvironment(locks);
  // Two documents in the same tab share the DOCUMENTS_APP_KIND-style scope; the
  // held lock means a second request would fall back to a per-tab seed, so the
  // resolved seed must be cached and the lock requested only once.
  const first = await getScopedPeerSeed("docs", environment);
  const second = await getScopedPeerSeed("docs", environment);
  expect(first).toBe("DEVICE");
  expect(second).toBe("DEVICE");
  expect(requestCount).toBe(1);
});

test("distinct (per-pane) scopes get distinct seeds and separate locks", async () => {
  const requestedLockNames: string[] = [];
  const locks: PeerSeedEnvironment["locks"] = {
    request: (name, _options, callback) => {
      requestedLockNames.push(name);
      return Promise.resolve(callback({}));
    },
  };
  // One tab (one environment), two pane-scoped seed scopes.
  const environment: PeerSeedEnvironment = {
    deviceStorage: memStorage(),
    sessionStorage: memStorage(),
    locks,
  };
  const left = await getScopedPeerSeed("documents:pane.left", environment);
  const right = await getScopedPeerSeed("documents:pane.right", environment);

  // Distinct device seeds → distinct Loro peer ids, and each pane acquires its
  // OWN device-peer lock, so both can be device-stable without sharing a peer.
  expect(left).not.toBe(right);
  expect(requestedLockNames).toEqual([
    "symcrypt.documents:pane.left.device-peer",
    "symcrypt.documents:pane.right.device-peer",
  ]);
});

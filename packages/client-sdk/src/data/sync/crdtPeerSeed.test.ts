import { expect, test } from "bun:test";
import { derivePeerId } from "@tearleads/loro";
import {
  getRuntimePeerSeed,
  getScopedPeerSeed,
  type PeerSeedEnvironment,
  recordPeerSeed,
} from "./crdtPeerSeed";

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

test("concurrent runtimes keep independent peers without growing device storage", async () => {
  const storedKeys = new Set<string>();
  const storage = memStorage();
  const environment: PeerSeedEnvironment = {
    deviceStorage: {
      getItem: storage.getItem,
      setItem(key, value) {
        storedKeys.add(key);
        storage.setItem(key, value);
      },
    },
    sessionStorage: memStorage(),
    locks: grantingLocks,
  };
  const owners = Array.from({ length: 20 }, () => ({}));
  const seeds = await Promise.all(
    owners.map((owner) => getRuntimePeerSeed("documents", owner, environment)),
  );
  expect(new Set(seeds).size).toBe(owners.length);
  expect(storedKeys.size).toBe(1);
  expect(storage.getItem("tearleads.documents.device-seed")).toBe(
    seeds[0] ?? null,
  );
  expect(
    await Promise.all(
      owners.map((owner) =>
        getRuntimePeerSeed("documents", owner, environment),
      ),
    ),
  ).toEqual(seeds);
});

test("a new tab runtime reuses the device seed when its exclusive lock is available", async () => {
  const environment = seededEnvironment(grantingLocks);
  const first = await getRuntimePeerSeed("docs", {}, environment);
  const afterReload = await getRuntimePeerSeed("docs", {}, { ...environment });
  expect(afterReload).toBe(first);
  expect(afterReload).toBe("DEVICE");
});

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
    "tearleads.documents:pane.left.device-peer",
    "tearleads.documents:pane.right.device-peer",
  ]);
});

test("a record's peer seed differs by runtime seed, user, and record", async () => {
  const seed = (runtimeSeed: string, userId: string | null, recordId: string) =>
    recordPeerSeed({ recordId, runtimeSeed, userId });
  const base = seed("DEVICE", "alice", "doc-1");

  // The same writer reloading the same record keeps its peer.
  expect(seed("DEVICE", "alice", "doc-1")).toBe(base);
  const peers = new Set([
    await derivePeerId(base),
    // Another record on the same device: another peer.
    await derivePeerId(seed("DEVICE", "alice", "doc-2")),
    // Another identity on the same device and record.
    await derivePeerId(seed("DEVICE", "bob", "doc-1")),
    await derivePeerId(seed("DEVICE", null, "doc-1")),
    // Another tab or device.
    await derivePeerId(seed("TAB", "alice", "doc-1")),
  ]);
  expect(peers.size).toBe(5);
  // The parts cannot run together into another record's seed.
  expect(seed("DEVICE", "alice:doc", "1")).not.toBe(
    seed("DEVICE", "alice", "doc:1"),
  );
});

test("a salt moves a record to another peer that every load derives again", async () => {
  const salted = (peerSalt: string | undefined) =>
    recordPeerSeed({
      peerSalt,
      recordId: "doc-1",
      runtimeSeed: "DEVICE",
      userId: "alice",
    });
  const unsalted = salted(undefined);

  expect(unsalted).toBe(
    recordPeerSeed({
      recordId: "doc-1",
      runtimeSeed: "DEVICE",
      userId: "alice",
    }),
  );
  expect(salted("salt-1")).toBe(salted("salt-1"));
  const peers = new Set([
    await derivePeerId(unsalted),
    await derivePeerId(salted("salt-1")),
    await derivePeerId(salted("salt-2")),
    // An empty salt is still a salt.
    await derivePeerId(salted("")),
  ]);
  expect(peers.size).toBe(4);
  // A salt cannot run together with the record id.
  expect(
    recordPeerSeed({
      peerSalt: "1",
      recordId: "doc",
      runtimeSeed: "DEVICE",
      userId: "alice",
    }),
  ).not.toBe(
    recordPeerSeed({
      recordId: "doc1",
      runtimeSeed: "DEVICE",
      userId: "alice",
    }),
  );
});

test("without device storage a runtime keeps one memory-only seed per scope", async () => {
  const runtime = {};
  const seed = await getRuntimePeerSeed("documents", runtime);
  expect(await getRuntimePeerSeed("documents", runtime)).toBe(seed);
  expect(await getRuntimePeerSeed("documents:pane-2", runtime)).not.toBe(seed);
  expect(await getRuntimePeerSeed("documents", {})).not.toBe(seed);
});

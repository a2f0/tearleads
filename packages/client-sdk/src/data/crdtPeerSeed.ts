interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
}

interface PeerSeedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PeerSeedEnvironment {
  readonly deviceStorage: PeerSeedStorage;
  readonly sessionStorage: PeerSeedStorage;
  readonly locks: LockManagerLike | null;
}

function getLockManager(): LockManagerLike | null {
  const navigatorValue = Reflect.get(globalThis, "navigator");
  if (typeof navigatorValue !== "object" || navigatorValue === null) {
    return null;
  }
  const locks = Reflect.get(navigatorValue, "locks");
  if (typeof locks !== "object" || locks === null) {
    return null;
  }
  const request = Reflect.get(locks, "request");
  if (typeof request !== "function") {
    return null;
  }
  return {
    request(name, options, callback) {
      try {
        return Promise.resolve(
          Reflect.apply(request, locks, [name, options, callback]),
        );
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

let defaultEnvironment: PeerSeedEnvironment | undefined;

function defaultPeerSeedEnvironment(): PeerSeedEnvironment {
  if (!defaultEnvironment) {
    defaultEnvironment = {
      deviceStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
      locks: getLockManager(),
    };
  }
  return defaultEnvironment;
}

// Per-environment, per-scope cache of the resolved seed. Repeated calls for the
// same scope in a tab MUST return the same seed: the exclusive device-peer lock
// is held by the first call for the tab's lifetime, so a fresh `ifAvailable`
// request would see it already taken and fall back to a per-tab seed, defeating
// the device-stable goal (e.g. every document shares the DOCUMENTS_APP_KIND
// scope). Keyed by environment so injected test environments stay isolated.
const seedCachesByEnvironment = new WeakMap<
  PeerSeedEnvironment,
  Map<string, Promise<string>>
>();

/**
 * Resolve to the device-stable seed only while this tab holds the exclusive
 * device-peer lock for `scope`; otherwise to the per-tab seed. The exclusive
 * lock guarantees at most one tab uses the device seed at a time, so two tabs
 * never share a CRDT peer id (which would corrupt the document). The lock is
 * held for the tab's lifetime and released on unload, so the next tab can reuse
 * the stable seed — sequential reuse, never concurrent sharing.
 */
function resolveDevicePeerSeed(
  locks: LockManagerLike,
  lockName: string,
  deviceSeed: string,
  perTabSeed: string,
): Promise<string> {
  return new Promise<string>((resolve) => {
    let settled = false;
    const settle = (seed: string) => {
      if (!settled) {
        settled = true;
        resolve(seed);
      }
    };
    try {
      void locks
        .request(lockName, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            // Another tab already owns the device peer for this scope.
            settle(perTabSeed);
            return;
          }
          settle(deviceSeed);
          // Hold the lock for the tab's lifetime; the browser releases it on unload.
          await new Promise<never>(() => {
            // Intentionally never settled.
          });
        })
        .catch(() => {
          settle(perTabSeed);
        });
    } catch {
      // A synchronous throw from the lock manager must not crash document init.
      settle(perTabSeed);
    }
  });
}

async function computeScopedPeerSeed(
  scope: string,
  environment: PeerSeedEnvironment,
): Promise<string> {
  const deviceSeedKey = `symcrypt.${scope}.device-seed`;
  const sessionPeerSeedKey = `symcrypt.${scope}.session-peer-seed`;

  let deviceSeed: string;
  let perTabSeed: string;
  try {
    const existingDeviceSeed = environment.deviceStorage.getItem(deviceSeedKey);
    deviceSeed = existingDeviceSeed ?? crypto.randomUUID();
    if (!existingDeviceSeed) {
      environment.deviceStorage.setItem(deviceSeedKey, deviceSeed);
    }

    const existingSessionSeed =
      environment.sessionStorage.getItem(sessionPeerSeedKey);
    const sessionSeed = existingSessionSeed ?? crypto.randomUUID();
    if (!existingSessionSeed) {
      environment.sessionStorage.setItem(sessionPeerSeedKey, sessionSeed);
    }
    perTabSeed = `${deviceSeed}:${sessionSeed}`;
  } catch {
    return crypto.randomUUID();
  }

  if (!environment.locks) {
    return perTabSeed;
  }
  return resolveDevicePeerSeed(
    environment.locks,
    `symcrypt.${scope}.device-peer`,
    deviceSeed,
    perTabSeed,
  );
}

export function getScopedPeerSeed(
  scope: string,
  environment?: PeerSeedEnvironment,
): Promise<string> {
  let environmentValue: PeerSeedEnvironment;
  try {
    environmentValue = environment ?? defaultPeerSeedEnvironment();
  } catch {
    return Promise.resolve(crypto.randomUUID());
  }

  let cache = seedCachesByEnvironment.get(environmentValue);
  if (!cache) {
    cache = new Map<string, Promise<string>>();
    seedCachesByEnvironment.set(environmentValue, cache);
  }
  const cached = cache.get(scope);
  if (cached) {
    return cached;
  }

  const seed = computeScopedPeerSeed(scope, environmentValue);
  cache.set(scope, seed);
  return seed;
}

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
      return Promise.resolve(
        Reflect.apply(request, locks, [name, options, callback]),
      );
    },
  };
}

function defaultPeerSeedEnvironment(): PeerSeedEnvironment {
  return {
    deviceStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    locks: getLockManager(),
  };
}

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
  });
}

export async function getScopedPeerSeed(
  scope: string,
  environment?: PeerSeedEnvironment,
): Promise<string> {
  const deviceSeedKey = `tearleads.${scope}.device-seed`;
  const sessionPeerSeedKey = `tearleads.${scope}.session-peer-seed`;

  let environmentValue: PeerSeedEnvironment;
  let deviceSeed: string;
  let perTabSeed: string;
  try {
    environmentValue = environment ?? defaultPeerSeedEnvironment();
    const existingDeviceSeed =
      environmentValue.deviceStorage.getItem(deviceSeedKey);
    deviceSeed = existingDeviceSeed ?? crypto.randomUUID();
    if (!existingDeviceSeed) {
      environmentValue.deviceStorage.setItem(deviceSeedKey, deviceSeed);
    }

    const existingSessionSeed =
      environmentValue.sessionStorage.getItem(sessionPeerSeedKey);
    const sessionSeed = existingSessionSeed ?? crypto.randomUUID();
    if (!existingSessionSeed) {
      environmentValue.sessionStorage.setItem(sessionPeerSeedKey, sessionSeed);
    }
    perTabSeed = `${deviceSeed}:${sessionSeed}`;
  } catch {
    return crypto.randomUUID();
  }

  if (!environmentValue.locks) {
    return perTabSeed;
  }
  return resolveDevicePeerSeed(
    environmentValue.locks,
    `tearleads.${scope}.device-peer`,
    deviceSeed,
    perTabSeed,
  );
}

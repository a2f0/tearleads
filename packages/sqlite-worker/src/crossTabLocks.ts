const CROSS_TAB_CLIENT_LOCK_PREFIX = "tearleads-sqlite-worker-client:";

export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true } | null,
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<void>;
  query?: () => Promise<unknown>;
}

export interface ClientLivenessLock {
  readonly ready: Promise<boolean>;
  release(): void;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown, key: string): string | null {
  if (!isObject(value)) {
    return null;
  }

  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : null;
}

export function lockManager(): LockManagerLike | null {
  const navigatorValue = Reflect.get(globalThis, "navigator");
  if (!isObject(navigatorValue)) {
    return null;
  }

  const locks = Reflect.get(navigatorValue, "locks");
  if (!isObject(locks)) {
    return null;
  }

  const request = Reflect.get(locks, "request");
  if (typeof request !== "function") {
    return null;
  }

  const query = Reflect.get(locks, "query");

  const manager: LockManagerLike = {
    request(name, options, callback) {
      const args =
        options === null ? [name, callback] : [name, options, callback];
      try {
        return Promise.resolve(Reflect.apply(request, locks, args)).then(
          () => undefined,
        );
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
  if (typeof query === "function") {
    manager.query = () => Promise.resolve(Reflect.apply(query, locks, []));
  }

  return manager;
}

export function canUseCrossTabPrimitives(): boolean {
  return (
    typeof BroadcastChannel !== "undefined" &&
    typeof MessageChannel !== "undefined" &&
    lockManager() !== null
  );
}

function clientLockName(clientId: string): string {
  return `${CROSS_TAB_CLIENT_LOCK_PREFIX}${clientId}`;
}

export function createClientLivenessLock(clientId: string): ClientLivenessLock {
  const locks = lockManager();
  if (!locks) {
    return {
      ready: Promise.resolve(false),
      release() {},
    };
  }

  let releaseLock: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let resolveReady: (hasClientLock: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
  });
  let readySettled = false;
  const resolveReadyOnce = (hasClientLock: boolean) => {
    if (readySettled) {
      return;
    }

    readySettled = true;
    resolveReady(hasClientLock);
  };

  void locks
    .request(clientLockName(clientId), null, async () => {
      resolveReadyOnce(true);
      await released;
    })
    .catch(() => {
      resolveReadyOnce(false);
    });

  return {
    ready,
    release() {
      releaseLock();
    },
  };
}

export async function queryLiveClientIds(): Promise<Set<string> | null> {
  const locks = lockManager();
  if (!locks?.query) {
    return null;
  }

  let snapshot: unknown;
  try {
    snapshot = await locks.query();
  } catch {
    return null;
  }

  if (!isObject(snapshot)) {
    return null;
  }

  const held = Reflect.get(snapshot, "held");
  if (!Array.isArray(held)) {
    return null;
  }

  const clientIds = new Set<string>();
  for (const lock of held) {
    const name = getString(lock, "name");
    if (!name?.startsWith(CROSS_TAB_CLIENT_LOCK_PREFIX)) {
      continue;
    }

    clientIds.add(name.slice(CROSS_TAB_CLIENT_LOCK_PREFIX.length));
  }

  return clientIds;
}

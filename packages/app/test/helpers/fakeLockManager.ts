// One Web Lock with the shared/exclusive semantics the device reset relies on,
// for test environments (happy-dom) whose navigator.locks cannot request: an
// exclusive request waits for every holder, a shared one only for an exclusive
// holder, and a request that cannot be granted at once queues in order.

interface LockRequest {
  readonly callback: () => Promise<void>;
  readonly mode: LockMode;
  readonly settle: PromiseWithResolvers<void>;
}

export interface FakeLockManager {
  /** Resolves the first time a request has to wait. */
  readonly queued: Promise<void>;
  readonly restore: () => void;
}

export function installFakeLockManager(): FakeLockManager {
  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  const queued = Promise.withResolvers<void>();
  const waiting: LockRequest[] = [];
  const holders: LockMode[] = [];
  const grantable = (mode: LockMode) =>
    holders.length === 0 ||
    (mode === "shared" && holders.every((held) => held === "shared"));
  const release = (mode: LockMode) => {
    holders.splice(holders.indexOf(mode), 1);
    while (waiting[0] && grantable(waiting[0].mode)) {
      const next = waiting.shift();
      if (next) grant(next);
    }
  };
  const grant = (request: LockRequest) => {
    holders.push(request.mode);
    void request.callback().then(
      () => {
        release(request.mode);
        request.settle.resolve();
      },
      (error: unknown) => {
        release(request.mode);
        request.settle.reject(error);
      },
    );
  };

  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (
        _name: string,
        options: { mode?: LockMode },
        callback: () => Promise<void>,
      ) => {
        const request: LockRequest = {
          callback,
          mode: options.mode ?? "exclusive",
          settle: Promise.withResolvers<void>(),
        };
        if (waiting.length === 0 && grantable(request.mode)) {
          grant(request);
        } else {
          waiting.push(request);
          queued.resolve();
        }
        return request.settle.promise;
      },
    },
  });

  return {
    queued: queued.promise,
    restore: () => {
      if (original) {
        Object.defineProperty(navigator, "locks", original);
      } else {
        Reflect.deleteProperty(navigator, "locks");
      }
    },
  };
}

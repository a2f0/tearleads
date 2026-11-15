import { afterEach, expect, test } from "bun:test";
import {
  isDeviceResetRequested,
  requestDeviceReset,
  runRequestedDeviceReset,
} from "./deviceReset";
import { holdAppPageLock } from "./deviceResetTabs";

const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

afterEach(() => {
  if (originalLocks) {
    Object.defineProperty(navigator, "locks", originalLocks);
  } else {
    Reflect.deleteProperty(navigator, "locks");
  }
  localStorage.clear();
});

interface LockRequest {
  readonly callback: () => Promise<void>;
  readonly mode: LockMode;
  readonly settle: { resolve: () => void; reject: (error: unknown) => void };
}

// One Web Lock with the shared/exclusive semantics the reset relies on: an
// exclusive request waits for every holder, and a request that cannot be
// granted at once is queued in order. Resolves `queued` the first time a
// request has to wait.
function installLockManager(): { queued: Promise<void> } {
  const queued = Promise.withResolvers<void>();
  const waiting: LockRequest[] = [];
  const holders: LockMode[] = [];
  const grantable = (mode: LockMode) =>
    holders.length === 0 ||
    (mode === "shared" && holders.every((held) => held === "shared"));
  const grant = (request: LockRequest) => {
    holders.push(request.mode);
    void request.callback().then(
      () => {
        holders.splice(holders.indexOf(request.mode), 1);
        request.settle.resolve();
        drain();
      },
      (error: unknown) => {
        holders.splice(holders.indexOf(request.mode), 1);
        request.settle.reject(error);
        drain();
      },
    );
  };
  const drain = () => {
    while (waiting[0] && grantable(waiting[0].mode)) {
      grant(waiting.shift() as LockRequest);
    }
  };
  const locks = {
    request: (
      _name: string,
      options: { mode?: LockMode },
      callback: () => Promise<void>,
    ) => {
      const settle = Promise.withResolvers<void>();
      const request = {
        callback,
        mode: options.mode ?? "exclusive",
        settle,
      };
      if (waiting.length === 0 && grantable(request.mode)) {
        grant(request);
      } else {
        waiting.push(request);
        queued.resolve();
      }
      return settle.promise;
    },
  };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: locks,
  });
  return { queued: queued.promise };
}

test("a wipe waits for every page with the app mounted, so their late writes are wiped too", async () => {
  const locks = installLockManager();
  requestDeviceReset(localStorage, () => {});
  // Another page still has the app mounted.
  const unloadPeer = holdAppPageLock();

  const reset = runRequestedDeviceReset(undefined);
  await locks.queued;
  // A write the peer had in flight lands while it is still mounted.
  localStorage.setItem("tearleads.local-session:tearleads.app:old", "late");
  expect(isDeviceResetRequested()).toBe(true);

  unloadPeer();
  await reset;

  expect(
    localStorage.getItem("tearleads.local-session:tearleads.app:old"),
  ).toBe(null);
  expect(isDeviceResetRequested()).toBe(false);
});

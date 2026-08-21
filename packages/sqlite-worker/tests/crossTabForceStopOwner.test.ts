import { expect, test } from "bun:test";
import { createCrossTabDatabaseWorker } from "../src/crossTabRuntime";
import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "../src/types";
import {
  MockLockManager,
  PortAwareWorker,
  requireCrossTabWorker,
  uniqueWorkerUrl,
  waitForMessage,
  waitUntil,
  withCrossTabGlobals,
} from "./crossTabTestHarness";

const OWNER_LOCK_NAME = "symcrypt-sqlite-worker-owner";

// A Worker whose Nth construction (1-based) decides its behaviour: a healthy
// PortAwareWorker-style echo for every construction except those in `silentOns`,
// which accept the connect port but NEVER reply — modelling an owner worker that
// went silent inside a hung OPFS init. The coordinator reuses one constructor for
// every owner it builds on a given URL, so switching by construction count is the
// only way to make the 2nd owner (the new identity's db) hang while the 1st and
// 3rd stay healthy.
class SwitchingWorker extends EventTarget {
  static constructions = 0;
  static instances: SwitchingWorker[] = [];
  static silentOns = new Set<number>();

  static reset(silentOns: number[]): void {
    SwitchingWorker.constructions = 0;
    SwitchingWorker.instances = [];
    SwitchingWorker.silentOns = new Set(silentOns);
  }

  readonly ports: MessagePort[] = [];
  readonly silent: boolean;
  terminated = false;

  constructor() {
    super();
    SwitchingWorker.constructions += 1;
    this.silent = SwitchingWorker.silentOns.has(SwitchingWorker.constructions);
    SwitchingWorker.instances.push(this);
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    if (
      typeof message !== "object" ||
      message === null ||
      Reflect.get(message, "type") !== WORKER_CONNECT_PORT_MESSAGE_TYPE
    ) {
      return;
    }

    const port = transfer?.[0];
    if (!(port instanceof MessagePort)) {
      throw new Error("Expected transferred MessagePort.");
    }

    this.ports.push(port);
    port.start();
    if (this.silent) {
      // Accept the port but never answer — the routed request sits forever.
      return;
    }

    port.addEventListener("message", (event) => {
      if (!(event instanceof MessageEvent)) {
        return;
      }

      const request = event.data as { id: number };
      port.postMessage({ id: request.id, result: { ok: true } });
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

test("a wedged (silent) owner worker is force-stopped on teardown so the next boot builds a fresh owner", async () => {
  // Regression for the Android new-identity hang. When a new identity's owner
  // worker goes silent (hung inside OPFS init), the coordinator's owner is
  // normally cleared ONLY by a close-response the silent worker never sends — so
  // `this.owner` stays pinned to the dead worker and, because the coordinator is a
  // per-URL module singleton, EVERY later database boot routes its init into the
  // dead worker over the untimed local path and hangs (the original db's fallback
  // boot included). Abrupt teardown (runtime.terminateNow -> forceStopOwner) must
  // stop the wedged owner so the next boot re-contends and builds a fresh one.
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    // Owner worker #2 (the new identity's db) is the silent/hung one; #1 (original
    // db) and #3 (the fallback on a fresh worker) are healthy.
    SwitchingWorker.reset([2]);
    const url = uniqueWorkerUrl("wedged-owner");

    // ---- Identity 1 boots on a healthy owner worker #1. ----
    const a = requireCrossTabWorker(
      createCrossTabDatabaseWorker(url, SwitchingWorker),
    );
    const aReady = waitForMessage(a);
    a.postMessage({ id: 1, method: "init", params: undefined });
    expect(await aReady).toEqual({ id: 1, result: { ok: true } });
    const owner1 = SwitchingWorker.instances[0];
    expect(owner1?.terminated).toBe(false);

    // ---- Switch away: an explicit close round-trips through the healthy worker #1
    // and tears owner #1 down (the normal path), releasing the owner lock. ----
    const aClosed = waitForMessage(a);
    a.postMessage({ id: 2, method: "close", params: undefined });
    expect(await aClosed).toEqual({ id: 2, result: { ok: true } });
    a.close();
    await waitUntil(() => owner1?.terminated === true);
    await waitUntil(() => !locks.heldLockNames.has(OWNER_LOCK_NAME));

    // ---- Identity 2 boots on owner worker #2, which is SILENT: the init is routed
    // to it and sits unanswered forever (the hung OPFS install). ----
    const b = requireCrossTabWorker(
      createCrossTabDatabaseWorker(url, SwitchingWorker),
    );
    let bAnswered = false;
    b.addEventListener("message", () => {
      bAnswered = true;
    });
    b.postMessage({ id: 3, method: "init", params: undefined });
    await waitUntil(() => SwitchingWorker.instances.length >= 2);
    const owner2 = SwitchingWorker.instances[1];
    await waitUntil(() => (owner2?.ports.length ?? 0) >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bAnswered).toBe(false); // silent: the init never answers

    // ---- The app gives up on the wedged boot and tears the runtime down. With the
    // worker silent, the graceful close never acks, so runtime.terminateNow() calls
    // forceStopOwner(). On the FIX this stops the silent owner; on the OLD code it
    // only unregistered the client and left `this.owner` pinned to worker #2. ----
    b.forceStopOwner();
    await waitUntil(() => owner2?.terminated === true);
    await waitUntil(() => !locks.heldLockNames.has(OWNER_LOCK_NAME));

    // ---- Fallback to the original identity: a fresh client must build a FRESH
    // owner (worker #3) and get its init answered. On the OLD code this init would
    // route into the still-pinned silent worker #2 and hang (waitForMessage would
    // time out), which is exactly the on-device "the original db also fails" log. ----
    const c = requireCrossTabWorker(
      createCrossTabDatabaseWorker(url, SwitchingWorker),
    );
    const cReady = waitForMessage(c, 2_000);
    c.postMessage({ id: 4, method: "init", params: undefined });
    expect(await cReady).toEqual({ id: 4, result: { ok: true } });
    const owner3 = SwitchingWorker.instances[2];
    expect(owner3).toBeDefined();
    expect(owner3).not.toBe(owner2);
    expect(owner3?.terminated).toBe(false);
  });
});

test("forceStopOwner leaves the owner running while another client is still attached", async () => {
  // The force-stop must be gated: tearing one wedged runtime down cannot terminate
  // an owner that is still serving another client (e.g. a sibling tab routing
  // remotely, or a second local runtime in this tab). Here two local clients share
  // one healthy owner; force-stopping one must NOT stop the owner.
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    PortAwareWorker.lastConstructed = null;
    const url = uniqueWorkerUrl("force-stop-gated");

    const a = requireCrossTabWorker(
      createCrossTabDatabaseWorker(url, PortAwareWorker),
    );
    const aReady = waitForMessage(a);
    a.postMessage({ id: 1, method: "init", params: undefined });
    expect(await aReady).toEqual({ id: 1, result: { ok: true } });

    const owner = PortAwareWorker.lastConstructed as PortAwareWorker | null;
    if (!owner) {
      throw new Error("Expected an owner worker to be constructed.");
    }

    // A second client on the same tab/coordinator attaches to the same owner.
    const b = requireCrossTabWorker(
      createCrossTabDatabaseWorker(url, PortAwareWorker),
    );
    const bReady = waitForMessage(b);
    b.postMessage({ id: 2, method: "init", params: undefined });
    expect(await bReady).toEqual({ id: 2, result: { ok: true } });

    // Force-stopping A must not stop the owner: B is still attached and active.
    a.forceStopOwner();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(owner.terminated).toBe(false);
    expect(locks.heldLockNames.has(OWNER_LOCK_NAME)).toBe(true);

    // B still works against the surviving owner.
    const bAgain = waitForMessage(b);
    b.postMessage({ id: 3, method: "init", params: undefined });
    expect(await bAgain).toEqual({ id: 3, result: { ok: true } });
  });
});

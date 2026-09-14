import { expect, test } from "bun:test";
import { createDatabaseWorkerClient } from "../src/client";
import { createCrossTabDatabaseWorker } from "../src/crossTabRuntime";
import { DatabaseWorkerCrashError } from "../src/workerCrash";
import {
  MockLockManager,
  PortAwareWorker,
  requireCrossTabWorker,
  SilentPortWorker,
  uniqueWorkerUrl,
  waitUntil,
  withCrossTabGlobals,
} from "./crossTabTestHarness";

const OWNER_LOCK_NAME = "tearleads-sqlite-worker-owner";

function crashLastSilentWorker(message: string): SilentPortWorker {
  const ownerWorker = SilentPortWorker.lastConstructed;
  if (!ownerWorker) {
    throw new Error("Expected the owner worker to be constructed.");
  }

  ownerWorker.dispatchEvent(
    new ErrorEvent("error", { message, filename: "/worker.js", lineno: 1 }),
  );
  return ownerWorker;
}

test("an owner worker crash rejects the owning tab's in-flight requests and releases ownership", async () => {
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    SilentPortWorker.lastConstructed = null;
    const worker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("crash"), SilentPortWorker),
    );
    const client = createDatabaseWorkerClient(worker);
    const pendingPing = client.ping();
    await waitUntil(
      () => (SilentPortWorker.lastConstructed?.ports.length ?? 0) === 1,
    );

    const ownerWorker = crashLastSilentWorker("owner worker crashed");

    const error = await pendingPing.then(
      () => null,
      (rejection: unknown) => rejection,
    );
    expect(error).toBeInstanceOf(DatabaseWorkerCrashError);
    expect(error).toMatchObject({
      message: "Database worker failed. owner worker crashed",
      detail: { filename: "/worker.js", lineno: 1 },
    });
    expect(ownerWorker.terminated).toBe(true);
    await waitUntil(() => !locks.heldLockNames.has(OWNER_LOCK_NAME));
    client.destroy();
    worker.close();
  });
});

test("a crash reaches a remote tab's client and the next boot builds a fresh owner", async () => {
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    SilentPortWorker.lastConstructed = null;
    // Tab A owns with a worker that accepts requests but never answers them.
    const ownerTabWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(
        uniqueWorkerUrl("crash-a"),
        SilentPortWorker,
      ),
    );
    await waitUntil(() => locks.heldLockNames.has(OWNER_LOCK_NAME));
    const ownerTabClient = createDatabaseWorkerClient(ownerTabWorker);
    const ownerTabPing = ownerTabClient.ping();

    // Tab B routes to A's owner over the channel; its owner bid stays queued.
    PortAwareWorker.lastConstructed = null;
    const remoteTabWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("crash-b"), PortAwareWorker),
    );
    const remoteTabClient = createDatabaseWorkerClient(remoteTabWorker);
    const remoteTabPing = remoteTabClient.ping();
    await waitUntil(
      () => (SilentPortWorker.lastConstructed?.ports.length ?? 0) === 2,
    );

    crashLastSilentWorker("owner worker crashed");

    await expect(ownerTabPing).rejects.toBeInstanceOf(DatabaseWorkerCrashError);
    await expect(remoteTabPing).rejects.toBeInstanceOf(
      DatabaseWorkerCrashError,
    );

    // Ownership was released, so tab B's queued bid is granted and it serves
    // its own requests from a fresh worker.
    await expect(remoteTabClient.ping()).resolves.toEqual({ ok: true });
    expect(PortAwareWorker.lastConstructed).not.toBeNull();

    ownerTabClient.destroy();
    ownerTabWorker.close();
    remoteTabClient.destroy();
    remoteTabWorker.close();
  });
});

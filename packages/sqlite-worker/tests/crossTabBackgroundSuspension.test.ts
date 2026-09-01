import { expect, test } from "bun:test";
import { createCrossTabDatabaseWorker } from "../src/crossTabRuntime";
import {
  MockLockManager,
  PortAwareWorker,
  requireCrossTabWorker,
  suspendFirstCrossTabChannel,
  uniqueWorkerUrl,
  waitForMessage,
  waitUntil,
  withCrossTabGlobals,
} from "./crossTabTestHarness";

const OWNER_LOCK_NAME = "tearleads-sqlite-worker-owner";

function currentPortAwareWorker(): PortAwareWorker | null {
  return PortAwareWorker.lastConstructed;
}

test("a remote request waits for a background-suspended owner to resume", async () => {
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    PortAwareWorker.lastConstructed = null;

    const ownerClient = requireCrossTabWorker(
      createCrossTabDatabaseWorker(
        uniqueWorkerUrl("background-owner"),
        PortAwareWorker,
      ),
    );
    const ownerReady = waitForMessage(ownerClient);
    ownerClient.postMessage({ id: 1, method: "ping", params: undefined });
    expect(await ownerReady).toEqual({ id: 1, result: { ok: true } });

    const ownerWorker = currentPortAwareWorker();
    if (!ownerWorker) {
      throw new Error("Expected the owner worker to be constructed.");
    }

    // A frozen background owner keeps its Web Lock, but its main-thread channel
    // tasks do not run until the browser resumes the tab. Queue delivery to that
    // channel while a foreground tab makes a request.
    const suspension = suspendFirstCrossTabChannel();
    const remoteClient = requireCrossTabWorker(
      createCrossTabDatabaseWorker(
        uniqueWorkerUrl("foreground-client"),
        PortAwareWorker,
      ),
    );
    let responseSettled = false;
    const remoteResponse = waitForMessage(remoteClient, 2_000).then(
      (response) => {
        responseSettled = true;
        return response;
      },
    );
    remoteClient.postMessage({ id: 2, method: "ping", params: undefined });

    await waitUntil(() => suspension.pendingMessageCount === 1);
    expect(responseSettled).toBe(false);
    expect(locks.heldLockNames.has(OWNER_LOCK_NAME)).toBe(true);
    expect(currentPortAwareWorker()).toBe(ownerWorker);
    expect(ownerWorker.ports).toHaveLength(1);

    suspension.resume();

    expect(await remoteResponse).toEqual({ id: 2, result: { ok: true } });
    expect(currentPortAwareWorker()).toBe(ownerWorker);
    expect(ownerWorker.ports).toHaveLength(2);
  });
});

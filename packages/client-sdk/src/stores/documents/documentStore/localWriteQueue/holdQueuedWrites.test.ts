import { expect, test } from "bun:test";
import type { DocumentStoreState } from "../state";
import { chainQueuedWrite, holdQueuedWritesFor } from "./index";

type QueueState = Pick<DocumentStoreState, "queuedWrites" | "writeChain">;

/** The two fields the write queue reads, standing in for a store's state. */
function queueState(): DocumentStoreState {
  const state: QueueState = { queuedWrites: 0, writeChain: Promise.resolve() };
  return state as DocumentStoreState;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("held work runs behind queued writes, and later writes wait for it", async () => {
  const state = queueState();
  const order: string[] = [];
  const earlier = deferred();
  const work = deferred();
  void chainQueuedWrite(
    state,
    earlier.promise.then(() => {
      order.push("earlier write");
    }),
  );

  const held = holdQueuedWritesFor(state, async () => {
    order.push("work started");
    await work.promise;
    order.push("work finished");
    return "result";
  });
  // Queued in the same tick as the hold: it waits behind the work.
  const later = chainQueuedWrite(
    state,
    state.writeChain.then(() => {
      order.push("later write");
    }),
  );
  expect(state.queuedWrites).toBe(3);

  await Promise.resolve();
  expect(order).toEqual([]);
  earlier.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(order).toEqual(["earlier write", "work started"]);
  work.resolve();

  expect(await held).toBe("result");
  await later;
  expect(order).toEqual([
    "earlier write",
    "work started",
    "work finished",
    "later write",
  ]);
  expect(state.queuedWrites).toBe(0);
});

test("held work that throws rejects its caller and releases the queue", async () => {
  const state = queueState();
  const failure = new Error("install failed");

  const held = holdQueuedWritesFor(state, async () => {
    throw failure;
  });
  const later = chainQueuedWrite(
    state,
    state.writeChain.then(() => undefined),
  );

  await expect(held).rejects.toBe(failure);
  await later;
  expect(state.queuedWrites).toBe(0);
});

test("held work still runs when an earlier queued write failed", async () => {
  const state = queueState();
  const earlier = chainQueuedWrite(
    state,
    Promise.reject(new Error("write failed")),
  );
  earlier.catch(() => undefined);

  expect(await holdQueuedWritesFor(state, async () => "ran")).toBe("ran");
});

import { expect, test } from "bun:test";
import { SocketQueue, type SocketQueueHandlers } from "./socketQueue";

function harness(options: { readonly holdOpen?: boolean } = {}) {
  const events: string[] = [];
  let releaseOpen = () => {};
  const opened = new Promise<void>((resolve) => {
    releaseOpen = resolve;
  });
  const handlers: SocketQueueHandlers = {
    open: async () => {
      events.push("open");
      if (options.holdOpen) {
        await opened;
      }
    },
    message: async (data) => {
      events.push(`message:${data}`);
    },
    close: () => {
      events.push("close");
    },
    report: (error) => {
      events.push(`report:${String(error)}`);
    },
    overflow: (reason) => {
      events.push(`overflow:${reason}`);
    },
  };
  return { events, handlers, releaseOpen };
}

test("events run in arrival order, open first", async () => {
  const { events, handlers } = harness();
  const queue = new SocketQueue(handlers);
  expect(queue.enqueue("a", 1)).toBe(true);
  expect(queue.enqueue("b", 1)).toBe(true);
  await queue.settled();
  queue.close();
  await queue.settled();
  expect(events).toEqual(["open", "message:a", "message:b", "close"]);
});

test("closing discards queued frames and closes right after the running event", async () => {
  const { events, handlers, releaseOpen } = harness({ holdOpen: true });
  const queue = new SocketQueue(handlers);
  queue.enqueue("a", 1);
  queue.enqueue("b", 1);
  queue.close();
  expect(queue.enqueue("c", 1)).toBe(false);
  releaseOpen();
  await queue.settled();
  expect(events).toEqual(["open", "close"]);
});

test("a flood beyond the frame count bound overflows, closes, and discards the queue", async () => {
  const { events, handlers, releaseOpen } = harness({ holdOpen: true });
  const queue = new SocketQueue(handlers, {
    maxQueuedMessages: 2,
    maxQueuedBytes: 1_000,
  });
  expect(queue.enqueue("a", 1)).toBe(true);
  expect(queue.enqueue("b", 1)).toBe(true);
  expect(queue.enqueue("c", 1)).toBe(false);
  expect(events).toEqual(["open", "overflow:Too many pending messages"]);
  // Already closed: later frames, including the peer's close, are no-ops.
  expect(queue.enqueue("d", 1)).toBe(false);
  releaseOpen();
  await queue.settled();
  queue.close();
  await queue.settled();
  expect(events).toEqual([
    "open",
    "overflow:Too many pending messages",
    "close",
  ]);
});

test("a flood beyond the byte bound overflows even under the frame count", async () => {
  const { events, handlers } = harness({ holdOpen: true });
  const queue = new SocketQueue(handlers, {
    maxQueuedMessages: 10,
    maxQueuedBytes: 100,
  });
  expect(queue.enqueue("x".repeat(60), 60)).toBe(true);
  expect(queue.enqueue("y".repeat(60), 60)).toBe(false);
  expect(events).toContain("overflow:Too many pending messages");
  expect(queue.enqueue("z", 1)).toBe(false);
});

test("a failing handler is reported and later events still run", async () => {
  const { events, handlers } = harness();
  const queue = new SocketQueue({
    ...handlers,
    message: async (data) => {
      if (data === "bad") {
        throw new Error("boom");
      }
      events.push(`message:${data}`);
    },
  });
  queue.enqueue("bad", 3);
  queue.enqueue("good", 4);
  await queue.settled();
  queue.close();
  await queue.settled();
  expect(events).toEqual([
    "open",
    "report:Error: boom",
    "message:good",
    "close",
  ]);
});

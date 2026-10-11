import { expect, test } from "bun:test";
import {
  SharedQueueBudget,
  SocketQueue,
  type SocketQueueHandlers,
} from "./socketQueue";

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

test("a shared budget closes the socket that would overrun the hub, not the others", async () => {
  const budget = new SharedQueueBudget(100);
  const first = harness({ holdOpen: true });
  const second = harness({ holdOpen: true });
  const limits = { maxQueuedMessages: 10, maxQueuedBytes: 1_000 };
  const firstQueue = new SocketQueue(first.handlers, limits, budget);
  const secondQueue = new SocketQueue(second.handlers, limits, budget);
  expect(firstQueue.enqueue("x".repeat(60), 60)).toBe(true);
  expect(secondQueue.enqueue("y".repeat(30), 30)).toBe(true);
  expect(budget.used).toBe(90);
  // The next 60 bytes would exceed 100: only the offending socket closes.
  expect(secondQueue.enqueue("z".repeat(60), 60)).toBe(false);
  expect(second.events).toEqual(["open", "overflow:Hub is busy"]);
  expect(first.events).toEqual(["open"]);
  // Releasing the second socket's reservation happens as its queue drains.
  first.releaseOpen();
  second.releaseOpen();
  await firstQueue.settled();
  await secondQueue.settled();
  expect(budget.used).toBe(0);
  expect(first.events).toEqual(["open", `message:${"x".repeat(60)}`]);
});

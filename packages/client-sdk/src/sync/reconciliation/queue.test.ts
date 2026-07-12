import { expect, test } from "bun:test";
import { createReconcileQueue } from "./queue";

test("reconcile queue serves active priority before idle", () => {
  const queue = createReconcileQueue();
  queue.enqueue("idle-1", "idle");
  queue.enqueue("active-1", "active");
  queue.enqueue("idle-2", "idle");

  expect(queue.dequeue()).toBe("active-1");
  expect(queue.dequeue()).toBe("idle-1");
  expect(queue.dequeue()).toBe("idle-2");
  expect(queue.dequeue()).toBeNull();
});

test("reconcile queue upgrades an idle container to active without duplicating", () => {
  const queue = createReconcileQueue();
  queue.enqueue("c-1", "idle");
  queue.enqueue("c-2", "idle");
  queue.enqueue("c-1", "active");

  expect(queue.size).toBe(2);
  expect(queue.dequeue()).toBe("c-1");
  expect(queue.dequeue()).toBe("c-2");
});

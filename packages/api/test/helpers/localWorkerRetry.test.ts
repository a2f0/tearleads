import { expect, test } from "bun:test";
import {
  LocalWorkerExitedEarlyError,
  retryPortCollisions,
} from "./localWorkerRetry";

const workerdCollision = new LocalWorkerExitedEarlyError(
  1,
  "✘ [ERROR] Address already in use (127.0.0.1:39985).",
);
const inspectorCollision = new LocalWorkerExitedEarlyError(
  1,
  "Error: listen EADDRINUSE: address already in use 127.0.0.1:9229",
);

function scriptedStarts(failures: readonly unknown[]) {
  let attempts = 0;
  const startOnce = async () => {
    const failure = failures[attempts];
    attempts += 1;
    if (failure !== undefined) throw failure;
    return "worker";
  };
  return { attempts: () => attempts, startOnce };
}

test.each([
  ["workerd", workerdCollision],
  ["the Node inspector", inspectorCollision],
])(
  "a port collision reported by %s starts again on fresh ports",
  async (_, collision) => {
    const starts = scriptedStarts([collision]);
    await expect(retryPortCollisions(starts.startOnce, 3)).resolves.toBe(
      "worker",
    );
    expect(starts.attempts()).toBe(2);
  },
);

test("the last collision propagates at the attempt cap", async () => {
  const starts = scriptedStarts([
    workerdCollision,
    workerdCollision,
    workerdCollision,
  ]);
  await expect(retryPortCollisions(starts.startOnce, 3)).rejects.toBe(
    workerdCollision,
  );
  expect(starts.attempts()).toBe(3);
});

test.each([
  ["a different early exit", new LocalWorkerExitedEarlyError(1, "SyntaxError")],
  // A timed-out start quotes the same output, but its full deadline is spent.
  [
    "a start timeout quoting a collision",
    new Error("wrangler dev was not ready\nAddress already in use"),
  ],
])("%s propagates without another start", async (_, failure) => {
  const starts = scriptedStarts([failure]);
  await expect(retryPortCollisions(starts.startOnce, 3)).rejects.toBe(failure);
  expect(starts.attempts()).toBe(1);
});

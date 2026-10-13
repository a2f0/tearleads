import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { runBlobTransfer } from "./transferPool";

test("four stalled transfers time out and admit a healthy transfer", async () => {
  const client = {};
  let release = () => {};
  const stalled = new Promise<void>((resolve) => {
    release = resolve;
  });
  const signals: AbortSignal[] = [];
  const blocked = Array.from({ length: 4 }, () =>
    runBlobTransfer(
      client,
      async (signal) => {
        signals.push(signal);
        await stalled; // Simulate a native transport that ignores abort.
      },
      20,
    ),
  );
  const outcomes = Promise.allSettled(blocked);
  let healthyRan = false;
  const healthy = runBlobTransfer(
    client,
    async () => {
      healthyRan = true;
    },
    1_000,
  );
  try {
    await waitFor(
      () => healthyRan,
      "stalled transfers monopolized every permit",
      200,
    );
    expect(
      (await outcomes).every((outcome) => outcome.status === "rejected"),
    ).toBe(true);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  } finally {
    release();
    await Promise.allSettled([...blocked, healthy]);
  }
});

test("waiting behind healthy transfers does not spend the transfer deadline", async () => {
  const client = {};
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = Array.from({ length: 4 }, () =>
    runBlobTransfer(client, () => held, 1_000),
  );
  let queuedRan = false;
  let queuedError: unknown = null;
  const queued = runBlobTransfer(
    client,
    async () => {
      queuedRan = true;
    },
    20,
  ).catch((error: unknown) => {
    queuedError = error;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queuedError).toBeNull();
    expect(queuedRan).toBe(false);
  } finally {
    release();
    await Promise.allSettled([...active, queued]);
  }
  expect(queuedRan).toBe(true);
});

test("download progress renews the idle deadline", async () => {
  await expect(
    runBlobTransfer(
      {},
      async (_signal, progress) => {
        for (let index = 0; index < 4; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          progress();
        }
        return "complete";
      },
      80,
    ),
  ).resolves.toBe("complete");
});

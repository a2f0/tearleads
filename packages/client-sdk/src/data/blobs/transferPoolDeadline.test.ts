import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/data/waitFor";
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

test("external cancellation retires queued and running downloads independently of host completion", async () => {
  const client = {};
  const requests = new AbortController();
  const queued = new AbortController();
  const held = Promise.withResolvers<void>();
  const entered: AbortSignal[] = [];
  const blocked = Array.from({ length: 4 }, () =>
    runBlobTransfer(
      client,
      async (signal) => {
        entered.push(signal);
        await held.promise;
      },
      undefined,
      undefined,
      requests.signal,
    ),
  );
  const results = Promise.allSettled(blocked);
  try {
    await waitFor(() => entered.length === 4, "downloads did not start", 200);
    const refused = runBlobTransfer(
      client,
      async () => {
        throw new Error("queued transfer started");
      },
      undefined,
      undefined,
      queued.signal,
    );
    const refusal = Promise.allSettled([refused]);
    queued.abort(new Error("queued stop"));
    requests.abort(new Error("stop"));
    await waitFor(
      () => entered.every((s) => s.aborted),
      "cancellation did not reach hosts",
      200,
    );
    expect(await runBlobTransfer(client, async () => "ready")).toBe("ready");
    expect((await refusal)[0]).toMatchObject({
      status: "rejected",
      reason: new Error("queued stop"),
    });
    expect((await results).every((row) => row.status === "rejected")).toBe(
      true,
    );
  } finally {
    held.resolve();
    await results;
  }
});

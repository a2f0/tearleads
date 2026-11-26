import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { ReconnectRefresh } from "./reconnectRefresh";

test("a shared manual refusal rejects while the reconnect schedules a retry", async () => {
  const recovery = new ReconnectRefresh(true);
  const refused = new KeyingVerificationError("equivocation", "refused policy");
  const first = Promise.withResolvers<boolean>();
  const retried = Promise.withResolvers<void>();
  let attempts = 0;
  try {
    recovery.runWhenReady(
      () => true,
      ({ reconnect }) => {
        if (++attempts === 1) {
          reconnect.record("refused", refused);
          return first.promise;
        }
        reconnect.record("complete");
        retried.resolve();
        return Promise.resolve(true);
      },
    );
    first.reject(refused);
    await expect(first.promise).rejects.toBe(refused);
    await Promise.race([
      retried.promise,
      Bun.sleep(1800).then(() => {
        throw new Error("Reconnect dropped the retry");
      }),
    ]);
    expect(attempts).toBe(2);
  } finally {
    recovery.reset("disposed");
  }
});

test("a reconnect crawl is owed from the acknowledgement until it completes", async () => {
  const never = new ReconnectRefresh(false);
  expect(never.owesCrawl).toBe(false);

  const recovery = new ReconnectRefresh(true);
  const crawl = Promise.withResolvers<boolean>();
  try {
    // Pending: acknowledged, and not yet able to run.
    expect(recovery.owesCrawl).toBe(true);
    recovery.runWhenReady(
      () => true,
      ({ reconnect }) => {
        reconnect.record("complete");
        return crawl.promise;
      },
    );
    // Crawling.
    expect(recovery.owesCrawl).toBe(true);
    crawl.resolve(true);
    await crawl.promise;
    await Promise.resolve();
    expect(recovery.owesCrawl).toBe(false);

    // A retry in backoff is still owed; a disposed machine owes nothing.
    recovery.reset("acknowledged");
    recovery.runWhenReady(
      () => true,
      async ({ reconnect }) => {
        reconnect.record("retry");
        return true;
      },
    );
    await Bun.sleep(1);
    expect(recovery.owesCrawl).toBe(true);
  } finally {
    recovery.reset("disposed");
  }
  expect(recovery.owesCrawl).toBe(false);
});

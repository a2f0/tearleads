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

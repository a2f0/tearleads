import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import type { BatchPlanning } from "./principalContainerRematerializationPlanning";
import {
  carryLevel,
  planOnceMoreAfterRollback,
} from "./principalContainerRematerializationPlanning";

// The server accepts at most the cap in carried rekeys, and a rematerialization
// below a stale chain has no lazy fallback, so the batch refuses at the cap
// before fetching or signing anything more.

test("carryLevel refuses past the carried-rekey cap before touching the API", async () => {
  const carriedPlan = { carried: true, planned: {}, rotated: null } as never;
  const batch = {
    knownContainerKeks: new Map(),
    plans: Array.from(
      { length: MAX_ROTATION_CONTAINER_REKEYS },
      () => carriedPlan,
    ),
    principalPolicyCache: new Map(),
    rematerialization: {
      apiClient: {
        getContainerWriterProjection: async () => {
          throw new Error("The cap must refuse before any fetch");
        },
      },
    },
    resolveProjectionUserKey: async () => null,
    rotatedAbove: [],
    authoredAbove: [],
  } as unknown as BatchPlanning;
  await expect(carryLevel(batch, {} as never)).rejects.toThrow(
    `Policy change would carry more than ${MAX_ROTATION_CONTAINER_REKEYS} descendant rekeys`,
  );
});

// This device's own re-citation of held descendants can pin a head between a
// batch reading it and verifying it (#2647). The batch is planned once more
// from fresh heads; anything else, or a second rollback, still fails it.
test("a batch is planned once more after a rollback, and only then", async () => {
  const rollback = () =>
    new KeyingVerificationError("rollback", "older than the local checkpoint");
  const run = async (outcomes: readonly (Error | string)[]) => {
    const evicted: string[] = [];
    let attempts = 0;
    const result = planOnceMoreAfterRollback(
      { evictContainerWriterProjection: (id) => evicted.push(id) },
      ["a", "c"],
      async () => {
        const outcome = outcomes[attempts];
        attempts += 1;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    );
    return { attempts: () => attempts, evicted, result };
  };

  const recovered = await run([rollback(), "planned"]);
  expect(await recovered.result).toBe("planned");
  expect(recovered.attempts()).toBe(2);
  expect(recovered.evicted).toEqual(["a", "c"]);

  const rolledBackAgain = await run([rollback(), rollback()]);
  await expect(rolledBackAgain.result).rejects.toThrow("local checkpoint");
  expect(rolledBackAgain.attempts()).toBe(2);

  const refused = await run([
    new KeyingVerificationError("hash_mismatch", "forged path"),
  ]);
  await expect(refused.result).rejects.toThrow("forged path");
  expect(refused.attempts()).toBe(1);
  expect(refused.evicted).toEqual([]);
});

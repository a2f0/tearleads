import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import { rebaseContainerWriterProjection } from "../child/rekey/rekeyProjection";
import type { BatchPlanning } from "./principalContainerRematerializationPlanning";
import {
  carryLevel,
  planOnceMoreAfterRollback,
  rerootOnAuthoredPaths,
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

function projection(
  containerIds: readonly string[],
  source: string,
): ContainerWriterProjectionResponse {
  return {
    containerId: containerIds.at(-1),
    organizationId: "organization",
    containerKeks: containerIds.map((containerId) => ({
      containerId,
      containerKeyEpochId: `${containerId}-${source}`,
    })),
    path: containerIds.map((containerId) => ({
      manifestHash: `${containerId}-${source}`,
    })),
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
  } as unknown as ContainerWriterProjectionResponse;
}

// A re-rooted target pins its served head before the batch signs beyond it,
// but a target a compound transaction already re-rooted on its preceding
// batch must pin nothing: a refused commit would leave pins ahead of the API.
test("a re-rooted target pins only a projection the API served", async () => {
  const touched: string[] = [];
  const batch = {
    authoredAbove: [projection(["root", "a"], "authored")],
    principalPolicyCache: new Map(),
    rematerialization: {
      execSql: async (sql: string) => {
        touched.push(sql);
        throw new Error("verification touched local state");
      },
    },
    resolveProjectionUserKey: async () => null,
  } as unknown as BatchPlanning;
  const served = projection(["root", "a", "b", "c"], "served");
  const preceding = rebaseContainerWriterProjection(
    served,
    projection(["root"], "preceding"),
  );
  if (!preceding) throw new Error("Expected a re-rooted projection");

  const rerooted = await rerootOnAuthoredPaths(batch, preceding);
  expect(rerooted.path.map((entry) => entry.manifestHash)).toEqual([
    "root-authored",
    "a-authored",
    "b-served",
    "c-served",
  ]);
  expect(touched).toEqual([]);

  await expect(rerootOnAuthoredPaths(batch, served)).rejects.toThrow();
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

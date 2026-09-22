import { expect, test } from "bun:test";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import type { BatchPlanning } from "./principalContainerRematerializationPlanning";
import { carryLevel } from "./principalContainerRematerializationPlanning";

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
  } as unknown as BatchPlanning;
  await expect(carryLevel(batch, {} as never)).rejects.toThrow(
    `Policy change would carry more than ${MAX_ROTATION_CONTAINER_REKEYS} descendant rekeys`,
  );
});

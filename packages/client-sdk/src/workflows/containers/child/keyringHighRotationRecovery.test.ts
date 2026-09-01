import { expect, test } from "bun:test";
import { CONTAINER_KEK_LOG_PAGE_LIMIT } from "@tearleads/validators/util";
import {
  makeEpochBridge,
  makeEpochKeys,
  makeLogEpoch,
} from "../../../../test/helpers/keyringRotationFixtures";
import {
  fetchContainerKekLog,
  rebuildKeyringEntriesFromLog,
} from "../../../data/documents/shared/keyringRebuild";

test("recovery crosses the KEK log page boundary", async () => {
  const containerId = crypto.randomUUID();
  const epochCount = CONTAINER_KEK_LOG_PAGE_LIMIT + 1;
  const keys = await makeEpochKeys(containerId, epochCount);
  const head = keys.at(-1);
  if (!head) {
    throw new Error("expected a head epoch");
  }

  const bridges = await Promise.all(
    keys.map(async (_key, index) =>
      index === 0 ? null : makeEpochBridge(containerId, keys, index),
    ),
  );
  const epochs = keys.map((key, index) =>
    makeLogEpoch(key, { bridge: bridges[index] ?? null }),
  );
  let pageRequests = 0;

  const log = await fetchContainerKekLog({
    apiClient: {
      getContainerKekLog: async (_requestedContainerId, options) => {
        pageRequests += 1;
        const start = options?.afterKeyEpoch ?? 0;
        const page = epochs.slice(start, start + CONTAINER_KEK_LOG_PAGE_LIMIT);
        return {
          containerId,
          epochs: page,
          hasMore: start + page.length < epochs.length,
        };
      },
    },
    containerId,
  });
  expect(pageRequests).toBe(2);
  expect(log.epochs).toHaveLength(epochCount);

  const rebuilt = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: head.keyMaterial,
    currentContainerKeyEpochId: head.containerKeyEpochId,
    log,
  });

  expect(rebuilt.missingEpochIds).toEqual([]);
  expect(rebuilt.entries).toEqual(
    keys.slice(0, -1).map((key) => ({
      containerKeyEpochId: key.containerKeyEpochId,
      keyMaterial: key.keyMaterial,
    })),
  );
}, 30_000);

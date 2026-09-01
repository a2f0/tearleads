import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import { promoteExistingLocalSystemContainerSync } from "./systemContainerPromotion";
import type { ContainerContentsStoreState } from "./types";

test("system promotion persists its create intent and initial update together", async () => {
  const metadataUpdate = new Uint8Array([1, 2, 3]);
  const containerState = {
    container: {
      id: "local-system",
      organizationId: "organization",
      parentId: "root",
      systemSlot: "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    record: {
      documentId: null,
      metadataUpdates: bytesToBase64(metadataUpdate),
    },
  } as ContainerState;
  const persistence = {
    listPendingCreateIntents: async () => [],
    listPendingUpdates: async () => [],
  } as unknown as ContainerContentsPersistence;
  const state = {
    persistence,
    runtime: {
      auth: { isAuthenticated: true },
      infra: { execSql: async () => [] },
      util: { log: () => undefined },
    },
  } as unknown as ContainerContentsStoreState;
  let current = true;
  let scheduleCount = 0;
  const promotions: Array<{
    metadataUpdate?: Uint8Array | undefined;
    parentContainerId: string;
    queueCreateIntent: boolean;
  }> = [];

  const promoted = await promoteExistingLocalSystemContainerSync({
    containerState,
    isCurrent: () => current,
    logLabel: "Container contents",
    options: {},
    persistPromotion: async (_candidate, promotion) => {
      promotions.push(promotion);
      current = false;
      return false;
    },
    rootState: null,
    state,
    syncAgent: {
      scheduleSync: () => {
        scheduleCount += 1;
      },
    } as unknown as ContainerContentsStoreSyncAgent,
  });

  expect(promoted).toBe(false);
  expect(promotions).toEqual([
    {
      metadataUpdate,
      parentContainerId: "root",
      queueCreateIntent: true,
    },
  ]);
  expect(scheduleCount).toBe(0);
});

import { expect, test } from "bun:test";
import { cachedContainerHydrationRuntime } from "../../../../../test/helpers/cachedContainerHydrationRuntime";
import { createTestContainerState } from "../../container-state/containerState.testFixtures";
import { projectionGeneration } from "../../projectionGeneration";
import type { RemoteContainer, RemoteContainerHydrationState } from "../types";
import { upsertRemoteContainerState } from "./remoteContainerState";

test.each(["manifest", "permission", "unchanged", "canceled"] as const)(
  "pull cache invalidation handles %s state before persistence",
  async (change) => {
    const held = createTestContainerState({ id: "folder", parentId: "root" });
    const child = createTestContainerState({ id: "child", parentId: "folder" });
    const other = createTestContainerState({ id: "other", parentId: "root" });
    const remote: RemoteContainer = {
      createdAt: "2026-10-27T00:00:00.000Z",
      effectiveAccessLevel: change === "permission" ? "read" : "admin",
      id: "folder",
      metadataAccessEpoch: change === "manifest" ? 2 : 1,
      metadataAccessStateHash:
        change === "manifest" ? "new-head" : "access-folder",
      metadataDocumentId: "metadata-folder",
      metadataReferencedPrincipals: [],
      organizationId: "organization",
      parentId: "root",
      systemSlot: null,
      updatedAt: "2026-10-27T00:00:01.000Z",
    };
    const runtime = cachedContainerHydrationRuntime([remote]);
    const events: string[] = [];
    runtime.apiClient.evictWriterProjectionsCiting = (ids) => {
      events.push(`evict:${ids.join(",")}`);
    };
    const state = {
      containersById: new Map([
        ["folder", held],
        ["child", child],
        ["other", other],
      ]),
      runtime,
    } as unknown as RemoteContainerHydrationState;
    await upsertRemoteContainerState({
      containerIdsWithPendingMetadataUpdates: new Set(),
      containerIdsWithPendingStructuralIntents: new Set(),
      host: {
        persistContainerState: async () => {
          events.push("persist");
          return { status: "stale-generation" };
        },
        updateSnapshot: () => {
          throw new Error("No state was committed");
        },
      },
      isCurrent: () => change !== "canceled",
      remoteContainer: remote,
      state,
    });
    const changed = change === "manifest" || change === "permission";
    expect(events).toEqual(
      change === "canceled"
        ? []
        : changed
          ? ["evict:folder", "persist"]
          : ["persist"],
    );
    expect(projectionGeneration(held)).toBe(changed ? 1 : 0);
    expect(projectionGeneration(child)).toBe(changed ? 1 : 0);
    expect(projectionGeneration(other)).toBe(0);
    expect(held.record.accessStateHash).toBe("access-folder");
    expect(held.container.effectiveAccessLevel).toBe("admin");
  },
);

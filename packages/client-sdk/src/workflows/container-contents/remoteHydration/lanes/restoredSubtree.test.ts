import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultContainerContentsPersistence } from "../../containerPersistence";
import { createContainerStateFingerprint } from "../remoteContainers/containerStateFingerprint";
import { applyContainerTombstones } from "../tombstoneApplication";
import type { RemoteContainerHydrationState } from "../types";
import {
  existingContainerState,
  remoteContainer,
  timestamp,
} from "./tombstoneApplication.testFixtures";

test("the restored folder keeps readable descendants and removes a child moved away during access loss", async () => {
  const { execSql, close } = await createTestExecSql("restored-subtree");
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const folder = existingContainerState("restored", "parent");
    const child = existingContainerState("moved-away", "restored");
    const readable = existingContainerState("still-here", "restored");
    const local = [folder, child, readable];
    const containersById = new Map(local.map((row) => [row.container.id, row]));
    for (const row of local)
      await defaultContainerContentsPersistence.saveContainer(
        execSql,
        row.container,
        row.record,
      );
    const item = {
      ...remoteContainer("restored", "parent"),
      reconcileDescendants: true as const,
    };
    const cursor = { id: "publication", updatedAt: timestamp };
    const state = {
      containersById,
      persistence: defaultContainerContentsPersistence,
      runtime: {
        infra: { execSql },
        apiClient: {
          listContainerDocumentLanes: async (request: {
            afterParentPage: unknown;
            lanes: { containerId: string; laneId: string }[];
          }) => {
            expect(request.afterParentPage).toEqual({
              parentId: "parent",
              watermark: cursor,
            });
            return {
              results: request.lanes.map(({ containerId, laneId }) =>
                containerId === child.container.id
                  ? { laneId, failure: { status: 403, error: "Forbidden" } }
                  : {
                      laneId,
                      page: {
                        items: [],
                        tombstones: [],
                        nextWatermark: null,
                        hasMore: false,
                      },
                    },
              ),
            };
          },
        },
      },
    } as unknown as RemoteContainerHydrationState;
    const result = await applyContainerTombstones({
      state,
      parentId: "parent",
      childIdsByParentId: new Map([
        ["restored", new Set(["moved-away", "still-here"])],
      ]),
      expectedContainerStates: new Map(
        local.map((row) => [
          row.container.id,
          {
            container: row.container,
            fingerprint: createContainerStateFingerprint(row),
          },
        ]),
      ),
      remoteContainerItems: [item],
      response: {
        items: [item],
        tombstones: [],
        nextWatermark: cursor,
        hasMore: false,
      },
    });
    expect(result).toEqual({ changedCount: 1, completed: true, current: true });
    expect([...containersById.keys()]).toEqual(["restored", "still-here"]);
    expect(
      await defaultContainerContentsPersistence.containerExists(
        execSql,
        "moved-away",
      ),
    ).toBe(false);
  } finally {
    await close();
  }
});

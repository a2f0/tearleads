import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  accessManifestHeads,
  containerSyncTombstones,
  containers,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { SyncWatermark } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { storeChildContainerAccessManifest } from "../../../test/helpers/containerManifests";
import {
  readContainerParentLanePage,
  requestContainerParentLanes,
} from "../../../test/helpers/containerParentLaneQuery";
import { registerUser } from "../../../test/helpers/registerUser";

const FIRST_UPDATED_AT = "2026-08-31T13:00:00.000Z";
const SECOND_UPDATED_AT = "2026-08-31T13:00:01.000Z";

type ContainerChangeFixture = {
  readonly id: string;
  readonly kind: "container" | "tombstone";
  readonly updatedAt: string;
};

const CHANGES: readonly ContainerChangeFixture[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    kind: "container",
    updatedAt: FIRST_UPDATED_AT,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    kind: "tombstone",
    updatedAt: FIRST_UPDATED_AT,
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    kind: "container",
    updatedAt: FIRST_UPDATED_AT,
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    kind: "tombstone",
    updatedAt: FIRST_UPDATED_AT,
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    kind: "tombstone",
    updatedAt: SECOND_UPDATED_AT,
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    kind: "container",
    updatedAt: SECOND_UPDATED_AT,
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    kind: "tombstone",
    updatedAt: SECOND_UPDATED_AT,
  },
  {
    id: "10000000-0000-4000-8000-000000000008",
    kind: "container",
    updatedAt: SECOND_UPDATED_AT,
  },
];

type ContainerPage = {
  readonly hasMore: boolean;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly updatedAt: string;
  }>;
  readonly nextWatermark: SyncWatermark | null;
  readonly tombstones: ReadonlyArray<{
    readonly containerId: string;
    readonly updatedAt: string;
  }>;
};

function changeKey(change: {
  readonly id: string;
  readonly updatedAt: string;
}) {
  return `${change.updatedAt}/${change.id}`;
}

function pageChangeKeys(page: ContainerPage): string[] {
  return [
    ...page.items.map((item) => changeKey(item)),
    ...page.tombstones.map((tombstone) =>
      changeKey({ id: tombstone.containerId, updatedAt: tombstone.updatedAt }),
    ),
  ].sort();
}

async function requestPage(input: {
  readonly limit: number;
  readonly owner: ReturnType<typeof createTestUser>;
  readonly watermark: SyncWatermark | null;
}): Promise<ContainerPage> {
  const laneId = "watermark-properties";
  const response = await requestContainerParentLanes(input.owner.token, [
    {
      laneId,
      limit: input.limit,
      parentId: input.owner.rootContainerId,
      watermark: input.watermark,
    },
  ]);

  expect(response.status).toBe(200);
  return readContainerParentLanePage(
    response,
    laneId,
  ) as Promise<ContainerPage>;
}

test("container discovery watermarks exhaust every mixed change exactly once", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const [root] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  const [rootHead] = await db
    .select({ manifestHash: accessManifestHeads.manifestHash })
    .from(accessManifestHeads)
    .where(eq(accessManifestHeads.objectId, owner.rootContainerId))
    .limit(1);
  if (!root || !rootHead) throw new Error("Expected registered root container");

  for (const change of CHANGES.toReversed()) {
    if (change.kind === "tombstone") continue;
    await db.insert(containers).values({
      depth: 1,
      id: change.id,
      organizationId: root.organizationId,
      parentId: owner.rootContainerId,
      updatedAt: new Date(change.updatedAt),
    });
    await storeChildContainerAccessManifest({
      childContainerId: change.id,
      dependencyManifestHashes: [rootHead.manifestHash],
      metadataDocumentId: crypto.randomUUID(),
      organizationId: root.organizationId,
      owner,
      parentContainerId: owner.rootContainerId,
      parentManifestHash: rootHead.manifestHash,
    });
  }
  await db.insert(containerSyncTombstones).values(
    CHANGES.toReversed()
      .filter((change) => change.kind === "tombstone")
      .map((change) => ({
        containerId: change.id,
        depth: 1,
        organizationId: root.organizationId,
        parentId: owner.rootContainerId,
        reason: "deleted" as const,
        updatedAt: new Date(change.updatedAt),
        userId: owner.userId,
      })),
  );

  const expectedChanges = CHANGES.toSorted((left, right) =>
    changeKey(left).localeCompare(changeKey(right)),
  );
  const expectedKeys = expectedChanges.map((change) => changeKey(change));
  for (let limit = 1; limit <= CHANGES.length; limit += 1) {
    const receivedKeys: string[] = [];
    let watermark: SyncWatermark | null = null;

    while (true) {
      const page = await requestPage({ limit, owner, watermark });
      const pageKeys = pageChangeKeys(page);
      const nextOffset = receivedKeys.length + pageKeys.length;

      expect(pageKeys).toEqual(
        expectedKeys.slice(receivedKeys.length, nextOffset),
      );
      expect(page.hasMore).toBe(nextOffset < expectedKeys.length);
      const expectedLastChange = expectedChanges[nextOffset - 1];
      expect(page.nextWatermark).toEqual(
        expectedLastChange
          ? {
              id: expectedLastChange.id,
              updatedAt: expectedLastChange.updatedAt,
            }
          : watermark,
      );
      receivedKeys.push(...pageKeys);
      if (!page.hasMore) break;
      if (!page.nextWatermark) throw new Error("Expected advancing watermark");
      watermark = page.nextWatermark;
    }

    expect(receivedKeys).toEqual(expectedKeys);
    expect(new Set(receivedKeys).size).toBe(expectedKeys.length);
  }
});

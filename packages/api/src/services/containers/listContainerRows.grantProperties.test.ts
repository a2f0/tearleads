import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import type { SyncWatermark } from "@tearleads/validators/response";
import {
  type ListingFixtureContainer,
  type ListingGrantSubject,
  seedListingContainer,
  seedListingGroup,
} from "../../../test/helpers/listingGrantFixture";
import type { ApiServiceRuntime } from "../runtime";
import {
  type AccessibleContainerRow,
  listAccessibleContainersForUser,
} from "./listContainerRows";

// The listing checks each candidate's own head for a grant and applies the
// watermark inside the candidate sets. This pins what it returns, page by
// page, against a model of the seeded rows: direct grants through the user or
// a current group, a parent path granted at an ancestor, a parent path with
// no grant, grants held only by a stale group state or another user, grants on
// a superseded manifest, repeated grant rows, and updated_at ties.

const runtime = { db } as unknown as ApiServiceRuntime;

function at(offsetMs: number): Date {
  return new Date(Date.UTC(2026, 9, 1) + offsetMs);
}

function compareRows(
  left: ListingFixtureContainer,
  right: ListingFixtureContainer,
): number {
  const byTime = left.updatedAt.getTime() - right.updatedAt.getTime();
  if (byTime !== 0) return byTime;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

async function seedFixture() {
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const groupId = await seedListingGroup({
    currentMember: userId,
    staleMember: null,
  });
  const staleGroupId = await seedListingGroup({
    currentMember: otherUserId,
    staleMember: userId,
  });
  const user: ListingGrantSubject = { subjectId: userId, subjectType: "user" };
  const group: ListingGrantSubject = {
    subjectId: groupId,
    subjectType: "group",
  };
  const staleGroup: ListingGrantSubject = {
    subjectId: staleGroupId,
    subjectType: "group",
  };
  const other: ListingGrantSubject = {
    subjectId: otherUserId,
    subjectType: "user",
  };
  const all: ListingFixtureContainer[] = [];
  const seed = async (
    parent: ListingFixtureContainer | null,
    offsetMs: number,
    grants: readonly ListingGrantSubject[],
    options: {
      readonly epoch?: number;
      readonly staleGrants?: readonly ListingGrantSubject[];
    } = {},
  ) => {
    const container = await seedListingContainer({
      ...options,
      grants,
      // Each organization has one root container.
      organizationId: parent?.organizationId ?? crypto.randomUUID(),
      parent,
      updatedAt: at(offsetMs),
    });
    all.push(container);
    return container;
  };
  // One child of each grant shape, two pairs sharing updated_at.
  const seedChildren = async (
    parent: ListingFixtureContainer,
    base: number,
  ) => [
    await seed(parent, base + 5, []),
    await seed(parent, base + 2, [user, other, user, group], { epoch: 3 }),
    await seed(parent, base + 2, [other]),
    await seed(parent, base + 9, [staleGroup]),
    await seed(parent, base + 7, [], { epoch: 2, staleGrants: [user] }),
    await seed(parent, base + 7, [group]),
  ];

  const grantedRoot = await seed(null, 1, [user]);
  const groupParent = await seed(grantedRoot, 50, [group]);
  const groupChildren = await seedChildren(groupParent, 100);
  const hiddenRoot = await seed(null, 3, [other]);
  const hiddenParent = await seed(hiddenRoot, 60, [], {
    epoch: 2,
    staleGrants: [user],
  });
  const hiddenChildren = await seedChildren(hiddenParent, 100);
  const hiddenLeafParent = hiddenChildren[0];
  const grantedLeafParent = hiddenChildren[1];
  if (!hiddenLeafParent || !grantedLeafParent) {
    throw new Error("Expected seeded children");
  }
  // Under a granted child of a hidden path, and under a hidden child.
  await seedChildren(grantedLeafParent, 200);
  await seedChildren(hiddenLeafParent, 300);

  const subjects = new Set([user, group].map(subjectKey));
  return {
    all,
    directlyGranted: (container: ListingFixtureContainer) =>
      container.grants.some((grant) => subjects.has(subjectKey(grant))),
    groupChildren,
    listings: [
      null,
      grantedRoot,
      groupParent,
      hiddenRoot,
      hiddenParent,
      hiddenLeafParent,
      grantedLeafParent,
    ],
    userId,
  };
}

function subjectKey(subject: ListingGrantSubject): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

function expectedListing(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  parent: ListingFixtureContainer | null,
): ListingFixtureContainer[] {
  const byId = new Map(
    fixture.all.map((container) => [container.id, container]),
  );
  const pathGranted = (
    container: ListingFixtureContainer | undefined,
  ): boolean =>
    container !== undefined &&
    (fixture.directlyGranted(container) ||
      (container.parentId !== null &&
        pathGranted(byId.get(container.parentId))));
  const visible =
    parent === null
      ? fixture.all.filter(fixture.directlyGranted)
      : fixture.all.filter(
          (container) =>
            container.parentId === parent.id &&
            (fixture.directlyGranted(container) || pathGranted(parent)),
        );
  return visible.toSorted(compareRows);
}

function rowModel(row: AccessibleContainerRow) {
  return {
    depth: row.depth,
    epoch: row.metadataAccessEpoch,
    id: row.id,
    manifestHash: row.metadataAccessStateHash,
    metadataDocumentId: row.metadataDocumentId,
    organizationId: row.organizationId,
    parentId: row.parentId,
    systemSlot: row.systemSlot,
    updatedAtMs: new Date(row.updatedAt).getTime(),
  };
}

function containerModel(container: ListingFixtureContainer) {
  return {
    depth: container.depth,
    epoch: container.epoch,
    id: container.id,
    manifestHash: container.manifestHash,
    metadataDocumentId: container.metadataDocumentId,
    organizationId: container.organizationId,
    parentId: container.parentId,
    systemSlot: null,
    updatedAtMs: container.updatedAt.getTime(),
  };
}

async function pageThrough(input: {
  readonly limit: number;
  readonly parentId: string | null;
  readonly userId: string;
}): Promise<AccessibleContainerRow[]> {
  const received: AccessibleContainerRow[] = [];
  let watermark: SyncWatermark | null = null;
  for (let page = 0; page < 50; page += 1) {
    const rows = await listAccessibleContainersForUser({
      ...input,
      runtime,
      watermark,
    });
    const pageRows = rows.slice(0, input.limit);
    received.push(...pageRows);
    const last = pageRows.at(-1);
    if (rows.length <= input.limit || !last) return received;
    watermark = { id: last.id, updatedAt: last.updatedAt };
  }
  throw new Error("Expected the listing to finish paging");
}

test("listings return each visible container once, in every page size", async () => {
  const fixture = await seedFixture();
  for (const parent of fixture.listings) {
    const expected = expectedListing(fixture, parent).map(containerModel);
    for (const limit of [1, 2, 3, 100]) {
      const rows = await pageThrough({
        limit,
        parentId: parent?.id ?? null,
        userId: fixture.userId,
      });
      expect(rows.map(rowModel)).toEqual(expected);
    }
  }
  // The model itself covers every shape: the root lane, an open parent with
  // all six children, and a closed parent showing only its granted children.
  expect(expectedListing(fixture, null)).toHaveLength(10);
  expect(expectedListing(fixture, fixture.listings[2] ?? null)).toEqual(
    fixture.groupChildren.toSorted(compareRows),
  );
  expect(expectedListing(fixture, fixture.listings[4] ?? null)).toHaveLength(2);
});

test("a watermark past every row returns nothing for any listing", async () => {
  const fixture = await seedFixture();
  for (const parent of fixture.listings) {
    const rows = await listAccessibleContainersForUser({
      limit: 10,
      parentId: parent?.id ?? null,
      runtime,
      userId: fixture.userId,
      watermark: {
        id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
        updatedAt: at(10_000).toISOString(),
      },
    });
    expect(rows).toEqual([]);
  }
});

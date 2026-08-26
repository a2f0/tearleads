import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  groups,
  organizationGroupTombstones,
  organizationRosterEntries,
} from "@symcrypt/api-shared/schema";
import type { VerifiedContainerAccessManifest } from "@symcrypt/crypto";
import { assertVerifiedContainerGrantReferencesValid } from "./groupReferences";

function manifestWithGroupGrant(input: {
  readonly groupId: string;
  readonly organizationId?: string;
}): VerifiedContainerAccessManifest {
  return {
    state: {
      organizationId: input.organizationId ?? crypto.randomUUID(),
      directGrants: [
        {
          accessLevel: "read",
          subjectId: input.groupId,
          subjectType: "group",
        },
      ],
    },
  } as VerifiedContainerAccessManifest;
}

test("verified container grants reject missing groups after locking references", async () => {
  const missingGroupId = crypto.randomUUID();

  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGrantReferencesValid({
        executor,
        manifest: manifestWithGroupGrant({ groupId: missingGroupId }),
      }),
    ),
  ).rejects.toMatchObject({
    message: "Container manifest references a missing group",
    status: 409,
  });
});

test("verified container grants reject tombstoned groups even if a catalog row exists", async () => {
  const groupId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  await db.insert(groups).values({
    id: groupId,
    name: "Deleted recipient",
    organizationId,
  });
  await db.insert(organizationGroupTombstones).values({
    groupId,
    organizationId,
  });

  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGrantReferencesValid({
        executor,
        manifest: manifestWithGroupGrant({ groupId, organizationId }),
      }),
    ),
  ).rejects.toMatchObject({
    message: "Container manifest references a deleted group",
    status: 409,
  });
});

test("verified container grants reject a group from another organization", async () => {
  const groupId = crypto.randomUUID();
  const groupOrganizationId = crypto.randomUUID();
  await db.insert(groups).values({
    id: groupId,
    name: "Cross-organization recipient",
    organizationId: groupOrganizationId,
  });

  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGrantReferencesValid({
        executor,
        manifest: manifestWithGroupGrant({
          groupId,
          organizationId: crypto.randomUUID(),
        }),
      }),
    ),
  ).rejects.toMatchObject({
    message: "Container group grants must stay within the organization",
    status: 409,
  });
});

test("verified container grants accept active users in the organization", async () => {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await db.insert(organizationRosterEntries).values({ organizationId, userId });
  const manifest = {
    state: {
      organizationId,
      directGrants: [
        {
          accessLevel: "read",
          subjectId: userId,
          subjectType: "user",
        },
      ],
    },
  } as VerifiedContainerAccessManifest;

  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGrantReferencesValid({ executor, manifest }),
    ),
  ).resolves.toBeUndefined();
});

test("verified container grants reject users outside the organization", async () => {
  const userId = crypto.randomUUID();
  await db.insert(organizationRosterEntries).values({
    organizationId: crypto.randomUUID(),
    userId,
  });
  const manifest = {
    state: {
      organizationId: crypto.randomUUID(),
      directGrants: [
        { accessLevel: "read", subjectId: userId, subjectType: "user" },
      ],
    },
  } as VerifiedContainerAccessManifest;

  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGrantReferencesValid({ executor, manifest }),
    ),
  ).rejects.toMatchObject({
    message: "Container user grants require active organization members",
    status: 409,
  });
});

test("verified container grants reject disabled organization users", async () => {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await db.insert(organizationRosterEntries).values({
    organizationId,
    status: "disabled",
    userId,
  });
  const manifest = {
    state: {
      organizationId,
      directGrants: [
        { accessLevel: "read", subjectId: userId, subjectType: "user" },
      ],
    },
  } as VerifiedContainerAccessManifest;

  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGrantReferencesValid({ executor, manifest }),
    ),
  ).rejects.toMatchObject({
    message: "Container user grants require active organization members",
    status: 409,
  });
});

test("verified container grants reject non-canonical group IDs", async () => {
  const groupId = crypto.randomUUID();
  await db.insert(groups).values({
    id: groupId,
    name: "Canonical group",
    organizationId: crypto.randomUUID(),
  });

  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGrantReferencesValid({
        executor,
        manifest: manifestWithGroupGrant({ groupId: groupId.toUpperCase() }),
      }),
    ),
  ).rejects.toMatchObject({
    message: "Container manifest references a missing group",
    status: 409,
  });
});

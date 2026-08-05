import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { assertVerifiedContainerGroupReferencesExist } from "./groupReferences";

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
      assertVerifiedContainerGroupReferencesExist({
        executor,
        manifest: manifestWithGroupGrant({ groupId: missingGroupId }),
      }),
    ),
  ).rejects.toMatchObject({
    message: "Container manifest references a missing group",
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
      assertVerifiedContainerGroupReferencesExist({
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

test("verified container grants preserve cross-organization organization grants", async () => {
  const containerOrganizationId = crypto.randomUUID();
  const recipientOrganizationId = crypto.randomUUID();
  const manifest = {
    state: {
      organizationId: containerOrganizationId,
      directGrants: [
        {
          accessLevel: "read",
          subjectId: recipientOrganizationId,
          subjectType: "organization",
        },
      ],
    },
  } as VerifiedContainerAccessManifest;

  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGroupReferencesExist({ executor, manifest }),
    ),
  ).resolves.toBeUndefined();
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
      assertVerifiedContainerGroupReferencesExist({
        executor,
        manifest: manifestWithGroupGrant({ groupId: groupId.toUpperCase() }),
      }),
    ),
  ).rejects.toMatchObject({
    message: "Container manifest references a missing group",
    status: 409,
  });
});

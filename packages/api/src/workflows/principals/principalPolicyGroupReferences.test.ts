import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { assertPrincipalPolicyGroupReferencesExist } from "./principalPolicyGroupReferences";

test("principal policy projections reject missing groups after locking references", async () => {
  const missingGroupId = crypto.randomUUID();

  await expect(
    db.transaction((tx) =>
      assertPrincipalPolicyGroupReferencesExist({
        projection: [
          {
            userId: missingGroupId,
            role: "member",
          },
        ],
        tx,
      }),
    ),
  ).rejects.toMatchObject({
    message: "Principal policy references a missing group",
    status: 409,
  });
});

test("principal policy projections reject non-canonical group IDs", async () => {
  const groupId = crypto.randomUUID();
  await db.insert(groups).values({
    id: groupId,
    name: "Canonical group",
    organizationId: crypto.randomUUID(),
  });

  await expect(
    db.transaction((tx) =>
      assertPrincipalPolicyGroupReferencesExist({
        projection: [
          {
            userId: groupId.toUpperCase(),
            role: "member",
          },
        ],
        tx,
      }),
    ),
  ).rejects.toMatchObject({
    message: "Principal policy references a missing group",
    status: 409,
  });
});

import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
} from "@symcrypt/api-shared/schema";
import { requireOrganizationGroupWithoutDeleteBlockers } from "./groupDeletion";

test("group deletion is blocked by a current container grant", async () => {
  const groupId = crypto.randomUUID();
  const groupOrganizationId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const manifestHash = `current:${crypto.randomUUID()}`;
  await db.insert(accessManifestHeads).values({
    epoch: 1,
    manifestHash,
    objectId: containerId,
    objectKind: "container",
    organizationId: groupOrganizationId,
  });
  await db.insert(accessManifestContainerGrantProjection).values({
    accessLevel: "read",
    containerId,
    manifestHash,
    subjectId: groupId,
    subjectType: "group",
  });

  await expect(
    requireOrganizationGroupWithoutDeleteBlockers({
      executor: db,
      groupId,
      organizationId: groupOrganizationId,
    }),
  ).rejects.toMatchObject({
    message: "Group has direct container grants",
    status: 409,
  });
});

import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
} from "@tearleads/api-shared/schema";
import { requireOrganizationGroupWithoutDeleteBlockers } from "./groupDeletion";

test("group deletion is blocked by a current container grant in another organization", async () => {
  const groupId = crypto.randomUUID();
  const groupOrganizationId = crypto.randomUUID();
  const foreignContainerId = crypto.randomUUID();
  const foreignOrganizationId = crypto.randomUUID();
  const manifestHash = `foreign-current:${crypto.randomUUID()}`;
  await db.insert(accessManifestHeads).values({
    epoch: 1,
    manifestHash,
    objectId: foreignContainerId,
    objectKind: "container",
    organizationId: foreignOrganizationId,
  });
  await db.insert(accessManifestContainerGrantProjection).values({
    accessLevel: "read",
    containerId: foreignContainerId,
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

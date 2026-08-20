import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
} from "@tearleads/api-shared/schema";
import { assertOrganizationUsersHaveNoCurrentDirectContainerGrants } from "./roster";

test("organization members with current direct grants cannot be disabled", async () => {
  const organizationId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const manifestHash = `current:${crypto.randomUUID()}`;
  await db.insert(accessManifestHeads).values({
    epoch: 1,
    manifestHash,
    objectId: containerId,
    objectKind: "container",
    organizationId,
  });
  await db.insert(accessManifestContainerGrantProjection).values({
    accessLevel: "read",
    containerId,
    manifestHash,
    subjectId: userId,
    subjectType: "user",
  });

  await expect(
    assertOrganizationUsersHaveNoCurrentDirectContainerGrants({
      executor: db,
      organizationId,
      userIds: [userId],
    }),
  ).rejects.toMatchObject({
    message:
      "Members with direct container grants must be unshared before removal",
    status: 409,
  });
});

test("superseded and foreign-organization direct grants do not block removal", async () => {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const supersededContainerId = crypto.randomUUID();
  await db.insert(accessManifestHeads).values({
    epoch: 2,
    manifestHash: `successor:${crypto.randomUUID()}`,
    objectId: supersededContainerId,
    objectKind: "container",
    organizationId,
  });
  await db.insert(accessManifestContainerGrantProjection).values({
    accessLevel: "read",
    containerId: supersededContainerId,
    manifestHash: `superseded:${crypto.randomUUID()}`,
    subjectId: userId,
    subjectType: "user",
  });
  const foreignContainerId = crypto.randomUUID();
  const foreignManifestHash = `foreign:${crypto.randomUUID()}`;
  await db.insert(accessManifestHeads).values({
    epoch: 1,
    manifestHash: foreignManifestHash,
    objectId: foreignContainerId,
    objectKind: "container",
    organizationId: crypto.randomUUID(),
  });
  await db.insert(accessManifestContainerGrantProjection).values({
    accessLevel: "read",
    containerId: foreignContainerId,
    manifestHash: foreignManifestHash,
    subjectId: userId,
    subjectType: "user",
  });

  await expect(
    assertOrganizationUsersHaveNoCurrentDirectContainerGrants({
      executor: db,
      organizationId,
      userIds: [userId],
    }),
  ).resolves.toBeUndefined();
});

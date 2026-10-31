import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
  containers,
  organizations,
} from "@tearleads/api-shared/schema";
import type {
  ContainerAccessManifestState,
  ContainerDirectGrant,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { storeChildContainerAccessManifest } from "../../../../../test/helpers/containerManifests";
import { getDefaultOrganizationId } from "../../../../../test/helpers/organizationMembership";
import { registerUser } from "../../../../../test/helpers/registerUser";
import { listOrganizationContainerGrantRows } from "../../../organizations/containerGrants";
import { assertContainerBuiltinGrantPolicyPreserved } from "./builtinGrants";

type Grant = Pick<
  ContainerDirectGrant,
  "accessLevel" | "subjectId" | "subjectType"
>;

interface ManifestInput {
  readonly body: Record<string, unknown>;
  readonly containerId: string;
  readonly directGrants: readonly Grant[];
  readonly eventType: "container.grant" | "container.revoke";
  readonly organizationId: string;
  readonly systemSlot?: string | null;
}

// The guard reads only these fields of a verified manifest.
function manifest(input: ManifestInput): VerifiedContainerAccessManifest {
  return {
    event: { body: input.body, event: { eventType: input.eventType } },
    state: {
      containerId: input.containerId,
      directGrants: input.directGrants,
      organizationId: input.organizationId,
      parentContainerId: null,
      systemSlot: input.systemSlot ?? null,
    },
  } as unknown as VerifiedContainerAccessManifest;
}

async function registeredOrganization() {
  const owner = createTestUser();
  await registerUser(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
      rootContainerId: organizations.rootContainerId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization row");
  return { ...organization, organizationId, owner, ownerId: owner.userId };
}

function guard(next: VerifiedContainerAccessManifest, previous: Grant[]) {
  return db.transaction((executor) =>
    assertContainerBuiltinGrantPolicyPreserved({
      executor,
      manifest: next,
      previousManifest: manifest({
        body: {},
        containerId: next.state.containerId,
        directGrants: previous,
        eventType: "container.grant",
        organizationId: next.state.organizationId,
      }),
    }),
  );
}

const builtinRefusal =
  "Built-in container grant cannot be revoked or change access level";

test("the derived root Admins grant cannot be revoked or change level, but can be rewrapped", async () => {
  const org = await registeredOrganization();
  const admins: Grant = {
    accessLevel: "admin",
    subjectId: org.adminGroupId,
    subjectType: "group",
  };
  const root = {
    containerId: org.rootContainerId,
    organizationId: org.organizationId,
  };

  await expect(
    guard(
      manifest({
        ...root,
        body: { subjectId: org.adminGroupId, subjectType: "group" },
        directGrants: [],
        eventType: "container.revoke",
      }),
      [admins],
    ),
  ).rejects.toThrow(builtinRefusal);
  await expect(
    guard(
      manifest({
        ...root,
        body: { grant: { ...admins, accessLevel: "read" } },
        directGrants: [{ ...admins, accessLevel: "read" }],
        eventType: "container.grant",
      }),
      [admins],
    ),
  ).rejects.toThrow(builtinRefusal);
  // A same-level grant is a rotation rewrap only when the grant already held.
  await expect(
    guard(
      manifest({
        ...root,
        body: { grant: admins },
        directGrants: [admins],
        eventType: "container.grant",
      }),
      [],
    ),
  ).rejects.toThrow(builtinRefusal);
  await guard(
    manifest({
      ...root,
      body: { grant: admins },
      directGrants: [admins],
      eventType: "container.grant",
    }),
    [admins],
  );

  // Members holds no built-in grant on the root.
  await guard(
    manifest({
      ...root,
      body: { subjectId: org.memberGroupId, subjectType: "group" },
      directGrants: [admins],
      eventType: "container.revoke",
    }),
    [admins, { ...admins, subjectId: org.memberGroupId }],
  );
});

test("Admins holds no built-in grant on an ordinary container", async () => {
  const org = await registeredOrganization();
  await guard(
    manifest({
      body: { subjectId: org.adminGroupId, subjectType: "group" },
      containerId: crypto.randomUUID(),
      directGrants: [],
      eventType: "container.revoke",
      organizationId: org.organizationId,
    }),
    [
      {
        accessLevel: "admin",
        subjectId: org.adminGroupId,
        subjectType: "group",
      },
    ],
  );
});

/** Counts only the guard's own statements, inside an open transaction. */
function countedGuard(next: VerifiedContainerAccessManifest) {
  return db.transaction(async (executor) => {
    const counter = { statements: 0 };
    await withDatabaseStatementCounter(counter, () =>
      assertContainerBuiltinGrantPolicyPreserved({
        executor,
        manifest: next,
        previousManifest: null,
      }),
    );
    return counter.statements;
  });
}

test("a user grant change reads nothing, and a group change one row", async () => {
  const org = await registeredOrganization();
  const root = {
    containerId: org.rootContainerId,
    directGrants: [],
    eventType: "container.revoke" as const,
    organizationId: org.organizationId,
  };
  const userRevoke = await countedGuard(
    manifest({
      ...root,
      body: { subjectId: org.ownerId, subjectType: "user" },
    }),
  );
  const groupRevoke = await countedGuard(
    manifest({
      ...root,
      body: { subjectId: org.memberGroupId, subjectType: "group" },
    }),
  );
  // Before derivation each read the built-in grant table once: 1 / 1.
  expect(userRevoke).toBe(0);
  expect(groupRevoke).toBe(1);
});

test("the derived metadata grants are refused through the reserved-root check", async () => {
  const org = await registeredOrganization();
  const metadata = {
    containerId: crypto.randomUUID(),
    organizationId: org.organizationId,
    systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: org.organizationId,
    }),
  };
  const admins: Grant = {
    accessLevel: "admin",
    subjectId: org.adminGroupId,
    subjectType: "group",
  };
  const members: Grant = {
    accessLevel: "read",
    subjectId: org.memberGroupId,
    subjectType: "group",
  };

  await expect(
    guard(
      manifest({
        ...metadata,
        body: { subjectId: org.memberGroupId, subjectType: "group" },
        directGrants: [admins],
        eventType: "container.revoke",
      }),
      [admins, members],
    ),
  ).rejects.toThrow("Organization metadata requires only reserved");
  await guard(
    manifest({
      ...metadata,
      body: { grant: members },
      directGrants: [admins, members],
      eventType: "container.grant",
    }),
    [admins, members],
  );
  // A metadata-root mutation reads the organization row once; before
  // derivation it also read the built-in grant table: 2.
  expect(
    await countedGuard(
      manifest({
        ...metadata,
        body: { subjectId: org.ownerId, subjectType: "user" },
        directGrants: [admins, members],
        eventType: "container.revoke",
      }),
    ),
  ).toBe(1);
});

test("reserved groups on an ordinary container list as not built-in", async () => {
  const org = await registeredOrganization();
  const childContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: childContainerId,
    organizationId: org.organizationId,
    parentId: org.rootContainerId,
  });
  const [rootHead] = await db
    .select({
      manifestHash: accessManifestHeads.manifestHash,
      state: accessManifests.state,
    })
    .from(accessManifestHeads)
    .innerJoin(
      accessManifests,
      eq(accessManifests.manifestHash, accessManifestHeads.manifestHash),
    )
    .where(eq(accessManifestHeads.objectId, org.rootContainerId));
  invariant(rootHead, "expected root manifest head");
  // The root's only grant is Admins, so its principal heads cover the child's.
  const rootState = rootHead.state as unknown as ContainerAccessManifestState;
  await storeChildContainerAccessManifest({
    childContainerId,
    dependencyManifestHashes: [rootHead.manifestHash],
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: org.adminGroupId,
        subjectType: "group",
      },
    ],
    metadataDocumentId: crypto.randomUUID(),
    organizationId: org.organizationId,
    owner: org.owner,
    parentContainerId: org.rootContainerId,
    parentManifestHash: rootHead.manifestHash,
    referencedPrincipalHeads: rootState.referencedPrincipalHeads,
  });

  const rows = await listOrganizationContainerGrantRows({
    executor: db,
    organizationId: org.organizationId,
  });
  // A null system slot makes the derivation null unless it is coalesced; the
  // flag must stay a boolean.
  expect(
    rows
      .filter((row) => row.containerId === childContainerId)
      .map((row) => row.isBuiltin),
  ).toEqual([false]);
  expect(
    rows
      .filter((row) => row.containerId === org.rootContainerId)
      .map((row) => [row.subjectId, row.isBuiltin]),
  ).toContainEqual([org.adminGroupId, true]);
});

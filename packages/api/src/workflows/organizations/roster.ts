import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  containers,
  documents,
  organizationRosterEntries,
  users,
} from "@symcrypt/api-shared/schema";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import type { OrganizationDirectoryUserResponse } from "@symcrypt/validators/response";
import { and, eq, inArray, ne } from "drizzle-orm";
import { uniqueSortedStrings } from "../../utils/array";
import { OrganizationManagerError } from "./errors";
import { listUsersReachableFromCurrentGroup } from "./principalReachability";
import { recordOrganizationReadModelChangeAudience } from "./readModelChanges";
import type { UserKeyRow } from "./users";

type OrganizationRosterEntryRow = typeof organizationRosterEntries.$inferSelect;

export function toOrganizationDirectoryUser(input: {
  readonly rosterEntry: OrganizationRosterEntryRow;
  readonly sessionUserId: string;
  readonly user: UserKeyRow;
}): OrganizationDirectoryUserResponse {
  return {
    userId: input.user.userId,
    signingKeyFingerprint: input.user.signingKeyFingerprint,
    signingPublicKey: input.user.signingPublicKey,
    encapsulationPublicKey: input.user.encapsulationPublicKey,
    encapsulationKeyFingerprint: input.user.encapsulationKeyFingerprint,
    createdAt: input.user.createdAt.toISOString(),
    isSelf: input.user.userId === input.sessionUserId,
    status: input.rosterEntry.status,
    profileDocumentId: input.rosterEntry.profileDocumentId,
    joinedAt: input.rosterEntry.joinedAt.toISOString(),
    updatedAt: input.rosterEntry.updatedAt.toISOString(),
    disabledAt: input.rosterEntry.disabledAt?.toISOString() ?? null,
    disabledByUserId: input.rosterEntry.disabledByUserId,
  };
}

export async function listOrganizationRosterEntries(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<OrganizationRosterEntryRow[]> {
  return input.executor
    .select()
    .from(organizationRosterEntries)
    .where(eq(organizationRosterEntries.organizationId, input.organizationId));
}

async function listActiveOrganizationRosterEntries(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<OrganizationRosterEntryRow[]> {
  return input.executor
    .select()
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, input.organizationId),
        eq(organizationRosterEntries.status, "active"),
      ),
    );
}

export async function loadOrganizationRosterEntry(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly userId: string;
}): Promise<OrganizationRosterEntryRow | null> {
  const [entry] = await input.executor
    .select()
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, input.organizationId),
        eq(organizationRosterEntries.userId, input.userId),
      ),
    )
    .limit(1);

  return entry ?? null;
}

export async function upsertActiveOrganizationRosterEntries(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly userIds: readonly string[];
}): Promise<string[]> {
  const userIds = uniqueSortedStrings(input.userIds);
  if (userIds.length === 0) {
    return [];
  }

  const now = new Date();
  const changedRows = await input.executor
    .insert(organizationRosterEntries)
    .values(
      userIds.map((userId) => ({
        organizationId: input.organizationId,
        userId,
        status: "active" as const,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [
        organizationRosterEntries.organizationId,
        organizationRosterEntries.userId,
      ],
      set: {
        status: "active",
        disabledAt: null,
        disabledByUserId: null,
        updatedAt: now,
      },
      // Only write (and bump updatedAt) when the member is actually
      // transitioning back to active. Without this guard, repeated policy
      // reconciliation would rewrite updatedAt for every active member, making
      // it track reconcile time rather than change time and rendering it
      // useless as a sync cursor. `status` is the authoritative signal:
      // disabledAt /
      // disabledByUserId are only ever set together with status="disabled" (see
      // disableOrganizationRosterEntries), so an already-active row is clean.
      setWhere: ne(organizationRosterEntries.status, "active"),
    })
    .returning({ userId: organizationRosterEntries.userId });

  return changedRows.map((row) => row.userId).sort();
}

async function disableOrganizationRosterEntries(input: {
  readonly disabledByUserId: string | null;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly userIds: readonly string[];
}): Promise<string[]> {
  const userIds = uniqueSortedStrings(input.userIds);
  if (userIds.length === 0) {
    return [];
  }

  const now = new Date();
  const changedRows = await input.executor
    .update(organizationRosterEntries)
    .set({
      status: "disabled",
      disabledAt: now,
      disabledByUserId: input.disabledByUserId,
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationRosterEntries.organizationId, input.organizationId),
        inArray(organizationRosterEntries.userId, userIds),
      ),
    )
    .returning({ userId: organizationRosterEntries.userId });

  return changedRows.map((row) => row.userId).sort();
}

export async function assertOrganizationUsersHaveNoCurrentDirectContainerGrants(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly userIds: readonly string[];
}): Promise<void> {
  const userIds = uniqueSortedStrings(input.userIds);
  if (userIds.length === 0) {
    return;
  }
  const [grant] = await input.executor
    .select({ id: accessManifestContainerGrantProjection.id })
    .from(accessManifestContainerGrantProjection)
    .innerJoin(
      accessManifestHeads,
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(
          accessManifestHeads.objectId,
          accessManifestContainerGrantProjection.containerId,
        ),
        eq(
          accessManifestHeads.manifestHash,
          accessManifestContainerGrantProjection.manifestHash,
        ),
      ),
    )
    .where(
      and(
        eq(accessManifestHeads.organizationId, input.organizationId),
        eq(accessManifestContainerGrantProjection.subjectType, "user"),
        inArray(accessManifestContainerGrantProjection.subjectId, userIds),
      ),
    )
    .limit(1);
  if (grant) {
    throw new OrganizationManagerError(
      "Members with direct container grants must be unshared before removal",
      409,
    );
  }
}

export async function syncOrganizationRosterFromMemberReachability(input: {
  readonly disabledByUserId: string | null;
  readonly executor: DatabaseSession;
  readonly memberGroupId: string;
  readonly organizationId: string;
}): Promise<{
  readonly changedUserIds: string[];
}> {
  const reachableUserIds = await listUsersReachableFromCurrentGroup({
    executor: input.executor,
    groupId: input.memberGroupId,
  });
  const activeUserIds = [...reachableUserIds].sort();
  const previousActiveEntries = await listActiveOrganizationRosterEntries({
    executor: input.executor,
    organizationId: input.organizationId,
  });

  const activatedUserIds = await upsertActiveOrganizationRosterEntries({
    executor: input.executor,
    organizationId: input.organizationId,
    userIds: activeUserIds,
  });

  const activeUserIdSet = new Set(activeUserIds);
  const disabledUserIds = previousActiveEntries
    .filter((entry) => !activeUserIdSet.has(entry.userId))
    .map((entry) => entry.userId);

  await assertOrganizationUsersHaveNoCurrentDirectContainerGrants({
    executor: input.executor,
    organizationId: input.organizationId,
    userIds: disabledUserIds,
  });

  const disabledUserIdsChanged = await disableOrganizationRosterEntries({
    disabledByUserId: input.disabledByUserId,
    executor: input.executor,
    organizationId: input.organizationId,
    userIds: disabledUserIds,
  });

  const changedUserIds = [
    ...activatedUserIds,
    ...disabledUserIdsChanged,
  ].sort();
  // The hint audience is otherwise the post-commit active roster; a member
  // this pass just disabled must still be woken to discover the denial.
  recordOrganizationReadModelChangeAudience(
    input.organizationId,
    changedUserIds,
  );
  return { changedUserIds };
}

export async function isOrganizationProfileDocument(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly profileDocumentId: string;
}): Promise<boolean> {
  const [head] = await input.executor
    .select({ objectId: accessManifestHeads.objectId })
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, input.profileDocumentId),
        eq(accessManifestHeads.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  return Boolean(head);
}

export async function isOrganizationRosterProfileDocumentForUser(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly profileDocumentId: string;
  readonly userId: string;
}): Promise<boolean> {
  const rosterProfileSystemSlot =
    await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: input.organizationId,
    });
  const links = await input.executor
    .select({
      organizationId: containers.organizationId,
      systemSlot: containers.systemSlot,
    })
    .from(accessManifestHeads)
    .innerJoin(
      accessManifestDocumentLinkProjection,
      and(
        eq(
          accessManifestDocumentLinkProjection.documentId,
          accessManifestHeads.objectId,
        ),
        eq(
          accessManifestDocumentLinkProjection.manifestHash,
          accessManifestHeads.manifestHash,
        ),
      ),
    )
    .innerJoin(
      containers,
      eq(containers.id, accessManifestDocumentLinkProjection.containerId),
    )
    .innerJoin(documents, eq(documents.id, accessManifestHeads.objectId))
    .innerJoin(
      users,
      and(
        eq(users.id, input.userId),
        eq(users.fingerprint, documents.createdByFingerprint),
      ),
    )
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, input.profileDocumentId),
        eq(accessManifestHeads.organizationId, input.organizationId),
      ),
    );

  return (
    links.length === 1 &&
    links[0]?.organizationId === input.organizationId &&
    links[0].systemSlot === rosterProfileSystemSlot
  );
}

export async function isOrganizationRosterProfileDocument(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly profileDocumentId: string;
}): Promise<boolean> {
  const rosterProfileSystemSlot =
    await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: input.organizationId,
    });
  const links = await input.executor
    .select({
      organizationId: containers.organizationId,
      systemSlot: containers.systemSlot,
    })
    .from(accessManifestHeads)
    .innerJoin(
      accessManifestDocumentLinkProjection,
      and(
        eq(
          accessManifestDocumentLinkProjection.documentId,
          accessManifestHeads.objectId,
        ),
        eq(
          accessManifestDocumentLinkProjection.manifestHash,
          accessManifestHeads.manifestHash,
        ),
      ),
    )
    .innerJoin(
      containers,
      eq(containers.id, accessManifestDocumentLinkProjection.containerId),
    )
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, input.profileDocumentId),
        eq(accessManifestHeads.organizationId, input.organizationId),
      ),
    );

  return (
    links.length === 1 &&
    links[0]?.organizationId === input.organizationId &&
    links[0].systemSlot === rosterProfileSystemSlot
  );
}

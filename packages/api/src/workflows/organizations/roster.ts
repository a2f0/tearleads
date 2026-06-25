import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import type { OrganizationDirectoryUserResponse } from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import { listUsersReachableFromCurrentGroup } from "./principalReachability";
import type { UserKeyRow } from "./users";

export type OrganizationRosterEntryRow =
  typeof organizationRosterEntries.$inferSelect;

export function toOrganizationDirectoryUser(input: {
  readonly rosterEntry: OrganizationRosterEntryRow;
  readonly sessionUserId: string;
  readonly user: UserKeyRow;
}): OrganizationDirectoryUserResponse {
  return {
    accountStatus: input.user.accountStatus,
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
}): Promise<void> {
  const userIds = [...new Set(input.userIds)].sort();
  if (userIds.length === 0) {
    return;
  }

  const now = new Date();
  await input.executor
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
    });
}

async function disableOrganizationRosterEntries(input: {
  readonly disabledByUserId: string | null;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly userIds: readonly string[];
}): Promise<void> {
  const userIds = [...new Set(input.userIds)].sort();
  if (userIds.length === 0) {
    return;
  }

  const now = new Date();
  await input.executor
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
    );
}

export async function syncOrganizationRosterFromMemberReachability(input: {
  readonly disabledByUserId: string | null;
  readonly executor: DatabaseSession;
  readonly memberGroupId: string;
  readonly organizationId: string;
}): Promise<void> {
  const reachableUserIds = await listUsersReachableFromCurrentGroup({
    executor: input.executor,
    groupId: input.memberGroupId,
  });
  const activeUserIds = [...reachableUserIds].sort();

  await upsertActiveOrganizationRosterEntries({
    executor: input.executor,
    organizationId: input.organizationId,
    userIds: activeUserIds,
  });

  const activeUserIdSet = new Set(activeUserIds);
  const disabledUserIds = (
    await listActiveOrganizationRosterEntries({
      executor: input.executor,
      organizationId: input.organizationId,
    })
  )
    .filter((entry) => !activeUserIdSet.has(entry.userId))
    .map((entry) => entry.userId);

  await disableOrganizationRosterEntries({
    disabledByUserId: input.disabledByUserId,
    executor: input.executor,
    organizationId: input.organizationId,
    userIds: disabledUserIds,
  });
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

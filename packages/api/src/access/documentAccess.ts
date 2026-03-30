import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../adapters/postgres";
import {
  groupMembers,
  objectAccessEpochs,
  objectAccessGrants,
  objectRecipientEnvelopes,
  organizationMembers,
  users,
} from "../schema";

const DOCUMENT_OBJECT_TYPE = "document";

type AccessLevel = "read" | "write" | "admin";
type SubjectType = "user" | "group" | "organization";

interface EffectiveDocumentRecipient {
  userId: string;
  accessLevel: AccessLevel;
  keyFingerprint: string;
}

interface DocumentAccessState {
  currentAccessEpoch: number;
  effectiveRecipients: EffectiveDocumentRecipient[];
}

function isAccessLevel(value: string): value is AccessLevel {
  return value === "read" || value === "write" || value === "admin";
}

function isSubjectType(value: string): value is SubjectType {
  return value === "user" || value === "group" || value === "organization";
}

function accessLevelRank(accessLevel: AccessLevel): number {
  if (accessLevel === "admin") {
    return 3;
  }

  if (accessLevel === "write") {
    return 2;
  }

  return 1;
}

function mergeAccessLevel(
  current: AccessLevel | undefined,
  incoming: AccessLevel,
): AccessLevel {
  if (!current) {
    return incoming;
  }

  return accessLevelRank(incoming) > accessLevelRank(current)
    ? incoming
    : current;
}

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

async function getCurrentEpoch(documentId: string): Promise<number | null> {
  const [row] = await db
    .select({ epoch: objectAccessEpochs.epoch })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, DOCUMENT_OBJECT_TYPE),
        eq(objectAccessEpochs.objectId, documentId),
      ),
    )
    .orderBy(desc(objectAccessEpochs.epoch))
    .limit(1);

  return row?.epoch ?? null;
}

async function loadDocumentGrantRows(documentId: string) {
  return db
    .select({
      subjectType: objectAccessGrants.subjectType,
      subjectId: objectAccessGrants.subjectId,
      accessLevel: objectAccessGrants.accessLevel,
    })
    .from(objectAccessGrants)
    .where(
      and(
        eq(objectAccessGrants.objectType, DOCUMENT_OBJECT_TYPE),
        eq(objectAccessGrants.objectId, documentId),
      ),
    );
}

function collectGrantedSubjectIds(
  grants: Array<{
    subjectType: string;
    subjectId: string;
    accessLevel: string;
  }>,
  subjectType: SubjectType,
): string[] {
  const result: string[] = [];

  for (const grant of grants) {
    if (
      !isSubjectType(grant.subjectType) ||
      !isAccessLevel(grant.accessLevel)
    ) {
      continue;
    }

    if (grant.subjectType === subjectType) {
      result.push(grant.subjectId);
    }
  }

  return uniqueSortedStrings(result);
}

async function loadMembershipRows(input: {
  organizationIds: string[];
  groupIds: string[];
}) {
  const organizationMemberships =
    input.organizationIds.length > 0
      ? await db
          .select({
            organizationId: organizationMembers.organizationId,
            userId: organizationMembers.userId,
          })
          .from(organizationMembers)
          .where(
            inArray(organizationMembers.organizationId, input.organizationIds),
          )
      : [];

  const groupMemberships =
    input.groupIds.length > 0
      ? await db
          .select({
            groupId: groupMembers.groupId,
            userId: groupMembers.userId,
          })
          .from(groupMembers)
          .where(inArray(groupMembers.groupId, input.groupIds))
      : [];

  return { organizationMemberships, groupMemberships };
}

async function loadRecipientUsers(userIds: string[]) {
  if (userIds.length === 0) {
    return [];
  }

  return db
    .select({
      id: users.id,
      encapsulationPublicKey: users.encapsulationPublicKey,
    })
    .from(users)
    .where(inArray(users.id, userIds));
}

export async function resolveDocumentAccessState(
  documentId: string,
): Promise<DocumentAccessState | null> {
  const currentAccessEpoch = await getCurrentEpoch(documentId);
  if (currentAccessEpoch === null) {
    return null;
  }

  const grants = await loadDocumentGrantRows(documentId);
  const directUserIds = collectGrantedSubjectIds(grants, "user");
  const organizationIds = collectGrantedSubjectIds(grants, "organization");
  const groupIds = collectGrantedSubjectIds(grants, "group");
  const { organizationMemberships, groupMemberships } =
    await loadMembershipRows({
      organizationIds,
      groupIds,
    });

  const effectiveAccessByUserId = new Map<string, AccessLevel>();

  for (const grant of grants) {
    if (
      !isSubjectType(grant.subjectType) ||
      !isAccessLevel(grant.accessLevel)
    ) {
      continue;
    }

    if (grant.subjectType === "user") {
      effectiveAccessByUserId.set(
        grant.subjectId,
        mergeAccessLevel(
          effectiveAccessByUserId.get(grant.subjectId),
          grant.accessLevel,
        ),
      );
      continue;
    }

    if (grant.subjectType === "organization") {
      for (const membership of organizationMemberships) {
        if (membership.organizationId === grant.subjectId) {
          effectiveAccessByUserId.set(
            membership.userId,
            mergeAccessLevel(
              effectiveAccessByUserId.get(membership.userId),
              grant.accessLevel,
            ),
          );
        }
      }
      continue;
    }

    for (const membership of groupMemberships) {
      if (membership.groupId === grant.subjectId) {
        effectiveAccessByUserId.set(
          membership.userId,
          mergeAccessLevel(
            effectiveAccessByUserId.get(membership.userId),
            grant.accessLevel,
          ),
        );
      }
    }
  }

  const effectiveUserIds = uniqueSortedStrings([
    ...directUserIds,
    ...Array.from(effectiveAccessByUserId.keys()),
  ]);
  const recipientUsers = await loadRecipientUsers(effectiveUserIds);

  const usersById = new Map(
    recipientUsers.map((user) => [user.id, user.encapsulationPublicKey]),
  );

  const effectiveRecipients: EffectiveDocumentRecipient[] = [];

  for (const userId of effectiveUserIds) {
    const encapsulationPublicKey = usersById.get(userId);
    const accessLevel = effectiveAccessByUserId.get(userId);

    if (!encapsulationPublicKey || !accessLevel) {
      continue;
    }

    const keyFingerprint = await toFingerprint(
      base64ToBytes(encapsulationPublicKey),
    );

    effectiveRecipients.push({
      userId,
      accessLevel,
      keyFingerprint,
    });
  }

  effectiveRecipients.sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );

  return {
    currentAccessEpoch,
    effectiveRecipients,
  };
}

export function canReadDocumentAccess(
  state: DocumentAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) => recipient.userId === userId,
  );
}

export function canWriteDocumentAccess(
  state: DocumentAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) =>
      recipient.userId === userId &&
      accessLevelRank(recipient.accessLevel) >= accessLevelRank("write"),
  );
}

export function listRecipientKeyFingerprints(
  state: DocumentAccessState,
): string[] {
  return state.effectiveRecipients.map((recipient) => recipient.keyFingerprint);
}

async function replaceRecipientEnvelopes(
  documentId: string,
  epoch: number,
  recipients: EffectiveDocumentRecipient[],
) {
  await db
    .delete(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, DOCUMENT_OBJECT_TYPE),
        eq(objectRecipientEnvelopes.objectId, documentId),
        eq(objectRecipientEnvelopes.epoch, epoch),
      ),
    );

  if (recipients.length === 0) {
    return;
  }

  await db.insert(objectRecipientEnvelopes).values(
    recipients.map((recipient) => ({
      objectType: DOCUMENT_OBJECT_TYPE,
      objectId: documentId,
      epoch,
      recipientUserId: recipient.userId,
      recipientKeyFingerprint: recipient.keyFingerprint,
    })),
  );
}

async function writeEpoch(documentId: string, epoch: number) {
  await db.insert(objectAccessEpochs).values({
    objectType: DOCUMENT_OBJECT_TYPE,
    objectId: documentId,
    epoch,
    updatedAt: new Date(),
  });
}

export async function initializeDocumentAccess(
  documentId: string,
  ownerUserId: string,
): Promise<number> {
  await db.insert(objectAccessGrants).values({
    objectType: DOCUMENT_OBJECT_TYPE,
    objectId: documentId,
    subjectType: "user",
    subjectId: ownerUserId,
    accessLevel: "admin",
  });

  await writeEpoch(documentId, 1);

  const state = await resolveDocumentAccessState(documentId);
  if (!state) {
    throw new Error("Failed to initialize document access state.");
  }

  await replaceRecipientEnvelopes(
    documentId,
    state.currentAccessEpoch,
    state.effectiveRecipients,
  );

  return state.currentAccessEpoch;
}

export async function grantDocumentAccess(input: {
  documentId: string;
  subjectType: SubjectType;
  subjectId: string;
  accessLevel: AccessLevel;
}): Promise<number> {
  await db
    .delete(objectAccessGrants)
    .where(
      and(
        eq(objectAccessGrants.objectType, DOCUMENT_OBJECT_TYPE),
        eq(objectAccessGrants.objectId, input.documentId),
        eq(objectAccessGrants.subjectType, input.subjectType),
        eq(objectAccessGrants.subjectId, input.subjectId),
      ),
    );

  await db.insert(objectAccessGrants).values({
    objectType: DOCUMENT_OBJECT_TYPE,
    objectId: input.documentId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    accessLevel: input.accessLevel,
  });

  const currentEpoch = await getCurrentEpoch(input.documentId);
  const nextEpoch = currentEpoch === null ? 1 : currentEpoch + 1;

  await writeEpoch(input.documentId, nextEpoch);

  const state = await resolveDocumentAccessState(input.documentId);
  if (!state) {
    throw new Error("Failed to resolve document access state after grant.");
  }

  await replaceRecipientEnvelopes(
    input.documentId,
    state.currentAccessEpoch,
    state.effectiveRecipients,
  );

  return state.currentAccessEpoch;
}

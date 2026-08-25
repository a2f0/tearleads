import {
  type DocumentList,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryUser,
} from "@symcrypt/client-sdk";

export interface RosterProfileBinding {
  readonly profileDocumentId: string;
  readonly userId: string;
}

function hasRosterProfileDocument(
  user: OrganizationDirectoryUser,
): user is OrganizationDirectoryUser & { profileDocumentId: string } {
  return user.profileDocumentId !== null;
}

export function getRosterProfileDocumentBindingKey(
  user: Pick<OrganizationDirectoryUser, "profileDocumentId" | "userId">,
): string | null {
  return user.profileDocumentId
    ? `${user.userId}\0${user.profileDocumentId}`
    : null;
}

export function getRosterProfileBindingsByLocalId(input: {
  readonly organizationId: string;
  readonly users: ReadonlyArray<OrganizationDirectoryUser>;
}): ReadonlyMap<string, RosterProfileBinding> {
  return new Map(
    input.users.filter(hasRosterProfileDocument).map((user) => [
      getRosterProfileDocumentLocalId({
        organizationId: input.organizationId,
        userId: user.userId,
      }),
      {
        profileDocumentId: user.profileDocumentId,
        userId: user.userId,
      },
    ]),
  );
}

export function getRosterProfileDocumentIds(
  profileBindingsByLocalId: ReadonlyMap<string, RosterProfileBinding>,
): ReadonlySet<string> {
  return new Set(
    [...profileBindingsByLocalId.values()].map(
      (profile) => profile.profileDocumentId,
    ),
  );
}

function getUsableRosterProfileTitle(title: string): string | null {
  const displayName = title.trim();
  return displayName.length > 0 && displayName !== "Untitled contact"
    ? displayName
    : null;
}

interface RosterProfileTitleRow {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

function isNewerRosterProfileTitle(
  candidate: RosterProfileTitleRow,
  current: RosterProfileTitleRow | undefined,
): boolean {
  return (
    !current ||
    candidate.updatedAt > current.updatedAt ||
    (candidate.updatedAt === current.updatedAt && candidate.id > current.id)
  );
}

export function getLocalRosterProfileDisplayNames(input: {
  readonly documents: DocumentList | null;
  readonly profileBindingsByLocalId: ReadonlyMap<string, RosterProfileBinding>;
}): ReadonlyMap<string, string> {
  const userIdsByProfileDocumentId = new Map<string, Set<string>>();
  for (const profile of input.profileBindingsByLocalId.values()) {
    const userIds =
      userIdsByProfileDocumentId.get(profile.profileDocumentId) ??
      new Set<string>();
    userIds.add(profile.userId);
    userIdsByProfileDocumentId.set(profile.profileDocumentId, userIds);
  }
  const latestDocumentsByUserId = new Map<string, RosterProfileTitleRow>();
  for (const document of input.documents?.rows ?? []) {
    const displayName = getUsableRosterProfileTitle(document.title);
    if (!displayName) {
      continue;
    }
    const userIds = document.documentId
      ? userIdsByProfileDocumentId.get(document.documentId)
      : undefined;
    if (!userIds) {
      continue;
    }
    for (const userId of userIds) {
      if (displayName === userId) {
        continue;
      }
      const current = latestDocumentsByUserId.get(userId);
      if (isNewerRosterProfileTitle(document, current)) {
        latestDocumentsByUserId.set(userId, document);
      }
    }
  }

  const names = new Map<string, string>();
  for (const [userId, document] of latestDocumentsByUserId) {
    names.set(userId, document.title.trim());
  }
  return names;
}

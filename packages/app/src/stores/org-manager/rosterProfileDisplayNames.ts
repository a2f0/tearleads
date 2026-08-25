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
  const latestDocumentsByUserId = new Map<
    string,
    { readonly id: string; readonly title: string; readonly updatedAt: string }
  >();
  for (const document of input.documents?.rows ?? []) {
    const userIds = document.documentId
      ? userIdsByProfileDocumentId.get(document.documentId)
      : undefined;
    if (!userIds) {
      continue;
    }
    for (const userId of userIds) {
      const current = latestDocumentsByUserId.get(userId);
      if (
        !current ||
        document.updatedAt > current.updatedAt ||
        (document.updatedAt === current.updatedAt && document.id > current.id)
      ) {
        latestDocumentsByUserId.set(userId, document);
      }
    }
  }

  const names = new Map<string, string>();
  for (const [userId, document] of latestDocumentsByUserId) {
    const displayName = document.title.trim();
    if (
      displayName.length > 0 &&
      displayName !== "Untitled contact" &&
      displayName !== userId
    ) {
      names.set(userId, displayName);
    }
  }
  return names;
}

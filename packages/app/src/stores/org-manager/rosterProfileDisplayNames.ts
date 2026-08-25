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

export function getLocalRosterProfileDisplayNames(input: {
  readonly documents: DocumentList | null;
  readonly profileBindingsByLocalId: ReadonlyMap<string, RosterProfileBinding>;
}): ReadonlyMap<string, string> {
  const latestDocumentsByUserId = new Map<
    string,
    { readonly id: string; readonly title: string; readonly updatedAt: string }
  >();
  for (const document of input.documents?.rows ?? []) {
    const profile = input.profileBindingsByLocalId.get(document.id);
    if (!profile || document.documentId !== profile.profileDocumentId) {
      continue;
    }
    const current = latestDocumentsByUserId.get(profile.userId);
    if (
      !current ||
      document.updatedAt > current.updatedAt ||
      (document.updatedAt === current.updatedAt && document.id > current.id)
    ) {
      latestDocumentsByUserId.set(profile.userId, document);
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

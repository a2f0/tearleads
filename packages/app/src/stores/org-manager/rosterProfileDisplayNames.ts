import {
  type DocumentList,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryUser,
} from "@tearleads/client-sdk";

export interface RosterProfileBinding {
  readonly canonicalLocalId: string;
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
    input.users.filter(hasRosterProfileDocument).map((user) => {
      const canonicalLocalId = getRosterProfileDocumentLocalId({
        organizationId: input.organizationId,
        userId: user.userId,
      });
      return [
        canonicalLocalId,
        {
          canonicalLocalId,
          profileDocumentId: user.profileDocumentId,
          userId: user.userId,
        },
      ];
    }),
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

type RosterProfileBindingsByDocumentId = ReadonlyMap<
  string,
  ReadonlyArray<RosterProfileBinding>
>;

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

function indexRosterProfileBindings(
  bindingsByLocalId: ReadonlyMap<string, RosterProfileBinding>,
): RosterProfileBindingsByDocumentId {
  const result = new Map<string, RosterProfileBinding[]>();
  for (const profile of bindingsByLocalId.values()) {
    const bindings = result.get(profile.profileDocumentId) ?? [];
    if (
      !bindings.some(
        (binding) =>
          binding.canonicalLocalId === profile.canonicalLocalId &&
          binding.userId === profile.userId,
      )
    ) {
      bindings.push(profile);
    }
    result.set(profile.profileDocumentId, bindings);
  }
  return result;
}

function findProfileDocumentIdsWithCanonicalRow(
  documents: DocumentList["rows"],
  bindingsByDocumentId: RosterProfileBindingsByDocumentId,
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const document of documents) {
    if (!document.documentId) continue;
    const bindings = bindingsByDocumentId.get(document.documentId);
    if (bindings?.some((binding) => document.id === binding.canonicalLocalId)) {
      result.add(document.documentId);
    }
  }
  return result;
}

function addRosterProfileTitleCandidates(input: {
  readonly bindingsByDocumentId: RosterProfileBindingsByDocumentId;
  readonly canonicalProfileDocumentIds: ReadonlySet<string>;
  readonly document: DocumentList["rows"][number];
  readonly latestDocumentsByUserId: Map<string, RosterProfileTitleRow>;
}): void {
  const { document } = input;
  const displayName = getUsableRosterProfileTitle(document.title);
  if (!displayName || !document.documentId) return;
  const bindings = input.bindingsByDocumentId.get(document.documentId);
  if (!bindings) return;
  if (
    input.canonicalProfileDocumentIds.has(document.documentId) &&
    !bindings.some((binding) => document.id === binding.canonicalLocalId)
  ) {
    return;
  }
  for (const { userId } of bindings) {
    const current = input.latestDocumentsByUserId.get(userId);
    if (
      displayName !== userId &&
      isNewerRosterProfileTitle(document, current)
    ) {
      input.latestDocumentsByUserId.set(userId, document);
    }
  }
}

export function getLocalRosterProfileDisplayNames(input: {
  readonly documents: DocumentList | null;
  readonly profileBindingsByLocalId: ReadonlyMap<string, RosterProfileBinding>;
}): ReadonlyMap<string, string> {
  const bindingsByProfileDocumentId = indexRosterProfileBindings(
    input.profileBindingsByLocalId,
  );
  const documents = input.documents?.rows ?? [];
  const profileDocumentIdsWithCanonicalRow =
    findProfileDocumentIdsWithCanonicalRow(
      documents,
      bindingsByProfileDocumentId,
    );
  const latestDocumentsByUserId = new Map<string, RosterProfileTitleRow>();
  for (const document of documents) {
    addRosterProfileTitleCandidates({
      bindingsByDocumentId: bindingsByProfileDocumentId,
      canonicalProfileDocumentIds: profileDocumentIdsWithCanonicalRow,
      document,
      latestDocumentsByUserId,
    });
  }

  const names = new Map<string, string>();
  for (const [userId, document] of latestDocumentsByUserId) {
    names.set(userId, document.title.trim());
  }
  return names;
}

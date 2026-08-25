import {
  type Documents,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryAndGroups,
} from "@symcrypt/client-sdk";
import {
  getLocalRosterProfileDisplayNames,
  getRosterProfileBindingsByLocalId,
  getRosterProfileDocumentBindingKey,
  type RosterProfileBinding,
} from "../../../stores/org-manager/rosterProfileDisplayNames";

interface ExplorerAttributionOrganizations {
  loadLocalDirectoryAndGroups: () => Promise<OrganizationDirectoryAndGroups | null>;
}

// Attribution labels are presentation over the locally projected roster. The
// demand-scoped catch-up is the only owner of remote reconciliation.
export async function loadExplorerAttributionDirectoryAndGroups(
  organizations: ExplorerAttributionOrganizations,
  reconciledProjection?: OrganizationDirectoryAndGroups | null,
) {
  if (reconciledProjection !== undefined) {
    return reconciledProjection;
  }
  return organizations.loadLocalDirectoryAndGroups();
}

export const MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS = 32;
export const MAX_EXPLORER_ATTRIBUTION_HYDRATION_DOCUMENTS = 32;

export interface ExplorerAttributionProfileHydrationRequest {
  readonly contributorUserIds: ReadonlyArray<string>;
  readonly documentId: string;
}

export type ExplorerAttributionProfileHydrationRequester = (
  request: ExplorerAttributionProfileHydrationRequest,
) => void;

export interface ExplorerAttributionHydrationDocumentSelection {
  readonly contributorUserIds: Set<string>;
}

export function getExplorerAttributionHydrationDocumentSelection(
  selectionsByDocumentId: Map<
    string,
    ExplorerAttributionHydrationDocumentSelection
  >,
  documentId: string,
): ExplorerAttributionHydrationDocumentSelection {
  const existing = selectionsByDocumentId.get(documentId);
  if (existing) {
    selectionsByDocumentId.delete(documentId);
    selectionsByDocumentId.set(documentId, existing);
    return existing;
  }
  if (
    selectionsByDocumentId.size >= MAX_EXPLORER_ATTRIBUTION_HYDRATION_DOCUMENTS
  ) {
    const oldestDocumentId = selectionsByDocumentId.keys().next().value;
    if (oldestDocumentId !== undefined) {
      selectionsByDocumentId.delete(oldestDocumentId);
    }
  }
  const selection = {
    contributorUserIds: new Set<string>(),
  };
  selectionsByDocumentId.set(documentId, selection);
  return selection;
}

export interface ExplorerAttributionProfileHydrationTarget {
  readonly bindingKey: string;
  readonly profileDocumentId: string;
  readonly userId: string;
}

export function getExplorerAttributionProfileDocumentLocalId(input: {
  readonly organizationId: string;
  readonly profileDocumentId: string;
  readonly userId: string;
}): string {
  return `${getRosterProfileDocumentLocalId(input)}:remote:${input.profileDocumentId}`;
}

/** Selects bounded contributor profiles visible to an organization admin. */
export function selectExplorerAttributionProfileHydrationTargets(input: {
  readonly contributorUserIds: ReadonlyArray<string>;
  readonly directoryAndGroups: OrganizationDirectoryAndGroups;
  readonly excludedBindingKeys?: ReadonlySet<string> | undefined;
  readonly includedBindingKeys?: ReadonlySet<string> | undefined;
  readonly limit?: number | undefined;
}): ExplorerAttributionProfileHydrationTarget[] {
  if (!input.directoryAndGroups.directory.currentUser.isOrgAdmin) {
    return [];
  }
  const usersById = new Map(
    input.directoryAndGroups.directory.users.map((user) => [user.userId, user]),
  );
  const contributorUserIds = [
    ...new Set(input.contributorUserIds.filter((userId) => userId.length > 0)),
  ];
  const targets = contributorUserIds
    .flatMap((userId) => {
      const user = usersById.get(userId);
      return user?.profileDocumentId
        ? [
            {
              bindingKey: `${user.userId}\0${user.profileDocumentId}`,
              profileDocumentId: user.profileDocumentId,
              status: user.status,
              userId: user.userId,
            },
          ]
        : [];
    })
    .filter(
      (target) =>
        !input.excludedBindingKeys?.has(target.bindingKey) &&
        (!input.includedBindingKeys ||
          input.includedBindingKeys.has(target.bindingKey)),
    );
  const orderedTargets = [
    ...targets.filter((target) => target.status === "disabled"),
    ...targets.filter((target) => target.status !== "disabled"),
  ];
  const limit = Math.max(
    0,
    Math.min(
      input.limit ?? MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS,
      MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS,
    ),
  );
  return orderedTargets
    .slice(0, limit)
    .map(({ status: _status, ...target }) => target);
}

/** Retains a cumulative per-document selection while resolving fresh bindings. */
export function selectExplorerAttributionHydrationTargetsForDocument(input: {
  readonly contributorUserIds: ReadonlyArray<string>;
  readonly directoryAndGroups: OrganizationDirectoryAndGroups;
  readonly excludedBindingKeys: ReadonlySet<string>;
  readonly selection: ExplorerAttributionHydrationDocumentSelection;
}): ExplorerAttributionProfileHydrationTarget[] {
  const selectedTargets = selectExplorerAttributionProfileHydrationTargets({
    contributorUserIds: [...input.selection.contributorUserIds],
    directoryAndGroups: input.directoryAndGroups,
  });
  const remaining =
    MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS -
    input.selection.contributorUserIds.size;
  const additionalTargets = selectExplorerAttributionProfileHydrationTargets({
    contributorUserIds: input.contributorUserIds.filter(
      (userId) => !input.selection.contributorUserIds.has(userId),
    ),
    directoryAndGroups: input.directoryAndGroups,
    limit: remaining,
  });
  for (const target of additionalTargets) {
    input.selection.contributorUserIds.add(target.userId);
  }
  return [...selectedTargets, ...additionalTargets].filter(
    (target) => !input.excludedBindingKeys.has(target.bindingKey),
  );
}

/** Opens one requested encrypted profile document and probes remote state. */
export function hydrateExplorerAttributionProfileDocument(input: {
  readonly containerId: string;
  readonly documents: Documents;
  readonly organizationId: string;
  readonly signal?: AbortSignal | undefined;
  readonly target: ExplorerAttributionProfileHydrationTarget;
}): Promise<boolean> {
  const { target } = input;
  return input.documents
    .open({
      containerId: input.containerId,
      documentId: target.profileDocumentId,
      localId: getExplorerAttributionProfileDocumentLocalId({
        organizationId: input.organizationId,
        profileDocumentId: target.profileDocumentId,
        userId: target.userId,
      }),
    })
    .requestRemoteSyncAndWait(input.signal);
}

export function getExplorerAttributionProjectionKey(input: {
  readonly projection?: OrganizationDirectoryAndGroups | null | undefined;
  readonly revision: number;
}): string {
  if (input.revision === 0) {
    return "local";
  }
  const directory = input.projection?.directory;
  if (!directory) {
    return "purged";
  }
  const profileDocuments = directory.users
    .map((user) => {
      const bindingKey = getRosterProfileDocumentBindingKey(user);
      return bindingKey ? `${bindingKey}\0${user.status}` : null;
    })
    .filter((key): key is string => key !== null)
    .sort();
  return JSON.stringify([directory.currentUser.isOrgAdmin, profileDocuments]);
}

export function getExplorerAttributionProfileBindingsByLocalId(input: {
  directoryAndGroups: OrganizationDirectoryAndGroups;
  organizationId: string;
}): ReadonlyMap<string, RosterProfileBinding> {
  const directory = input.directoryAndGroups.directory;
  if (
    !directory.currentUser.isOrgAdmin ||
    directory.organizationId !== input.organizationId
  ) {
    return new Map();
  }
  const bindings = new Map(
    getRosterProfileBindingsByLocalId({
      organizationId: input.organizationId,
      users: directory.users,
    }),
  );
  for (const user of directory.users) {
    if (!user.profileDocumentId) {
      continue;
    }
    bindings.set(
      getExplorerAttributionProfileDocumentLocalId({
        organizationId: input.organizationId,
        profileDocumentId: user.profileDocumentId,
        userId: user.userId,
      }),
      {
        profileDocumentId: user.profileDocumentId,
        userId: user.userId,
      },
    );
  }
  return bindings;
}

export const getExplorerAttributionProfileDisplayNames =
  getLocalRosterProfileDisplayNames;

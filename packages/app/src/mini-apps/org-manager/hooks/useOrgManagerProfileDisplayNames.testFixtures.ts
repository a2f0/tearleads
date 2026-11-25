import { mock } from "bun:test";
import {
  type DocumentSummary,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectory,
  type OrganizationDirectoryUser,
  type PersistedDocumentListener,
} from "@tearleads/client-sdk";
import type {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";

export const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
export const USER_ID = "00000000-0000-4000-8000-000000000002";
export const PROFILE_DOCUMENT_ID = "00000000-0000-4000-8000-000000000003";
export const SECOND_PROFILE_DOCUMENT_ID =
  "00000000-0000-4000-8000-000000000004";

export function rosterUser(input: {
  profileDocumentId: string | null;
  userId: string;
}): OrganizationDirectoryUser {
  return {
    createdAt: "2026-05-20T12:00:00.000Z",
    disabledAt: null,
    disabledByUserId: null,
    twoFactorRequired: false,
    encapsulationKeyFingerprint: `encapsulation-${input.userId}`,
    isPersonalOrganizationOwner: false,
    isSelf: false,
    joinedAt: "2026-05-20T12:00:00.000Z",
    leaveRequest: null,
    profileDocumentId: input.profileDocumentId,
    signingKeyFingerprint: `signing-${input.userId}`,
    status: "active",
    updatedAt: "2026-05-20T12:00:00.000Z",
    userId: input.userId,
  };
}

export function directory(
  users: OrganizationDirectoryUser[],
  organizationId = ORGANIZATION_ID,
  isOrgAdmin = true,
): OrganizationDirectory {
  return {
    currentUser: { isOrgAdmin },
    organizationId,
    profileDocumentId: null,
    users,
  };
}

export function profileSummary(input: {
  profileDocumentId: string;
  title: string;
  userId: string;
}): DocumentSummary {
  return {
    containerId: "local-profile-container",
    documentId: input.profileDocumentId,
    documentKind: "contact",
    id: getRosterProfileDocumentLocalId({
      organizationId: ORGANIZATION_ID,
      userId: input.userId,
    }),
    title: input.title,
    updatedAt: "2026-05-20T12:00:00.000Z",
  };
}

export function runtime(input?: {
  dbStatus?: string;
  domainScope?: object;
  isAuthenticated?: boolean;
  organizationId?: string | null;
  userId?: string | null;
}) {
  return {
    auth: {
      isAuthenticated: input?.isAuthenticated ?? true,
      organizationId: input?.organizationId ?? ORGANIZATION_ID,
      userId: input?.userId ?? "viewer-user-id",
    },
    infra: { dbStatus: input?.dbStatus ?? "ready" },
    state: { domainScope: input?.domainScope ?? {} },
  } as unknown as ReturnType<typeof useTearleadsRuntime>;
}

export function createTearleadsHarness(
  rowsInput: ReadonlyArray<DocumentSummary> = [],
) {
  let rows = rowsInput;
  const listeners = new Set<PersistedDocumentListener>();
  const requestSync = mock(() => undefined);
  const requestRemoteSyncAndWait = mock((_signal?: AbortSignal) =>
    Promise.resolve(true),
  );
  const open = mock((_input: object, _options?: object) => ({
    requestRemoteSyncAndWait,
    requestSync,
  }));
  const findLocalIdByDocumentId = mock((_documentId: string) =>
    Promise.resolve<string | null>(null),
  );
  const list = mock(() => Promise.resolve({ rows, totalCount: rows.length }));
  const subscribe = mock((listener: PersistedDocumentListener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const loadDirectoryAndGroups = mock(() => Promise.resolve(null));
  const loadLocalDirectoryAndGroups = mock(() => Promise.resolve(null));
  const logError = mock(() => undefined);
  const tearleads = {
    documents: { findLocalIdByDocumentId, list, open, subscribe },
    logError,
    organizations: {
      loadDirectoryAndGroups,
      loadLocalDirectoryAndGroups,
    },
  } as unknown as ReturnType<typeof useTearleads>;

  return {
    emit(document: DocumentSummary) {
      rows = [...rows.filter((row) => row.id !== document.id), document];
      for (const listener of listeners) {
        listener(document, { placementChanged: false });
      }
    },
    findLocalIdByDocumentId,
    list,
    loadDirectoryAndGroups,
    loadLocalDirectoryAndGroups,
    logError,
    open,
    requestRemoteSyncAndWait,
    requestSync,
    subscribe,
    tearleads,
  };
}

/** A device that has not listed the Roster Profiles container. */
export const findNoRosterProfileContainer = () => Promise.resolve(null);

/** A container listing that never changes. */
export const subscribeToNoContainerChanges = () => () => undefined;

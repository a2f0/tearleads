import { expect, mock, test } from "bun:test";
import type {
  Documents,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
} from "@symcrypt/client-sdk";
import { getRosterProfileDocumentLocalId } from "@symcrypt/client-sdk";
import {
  getExplorerAttributionHydrationDocumentSelection,
  getExplorerAttributionProfileBindingsByLocalId,
  getExplorerAttributionProfileDisplayNames,
  getExplorerAttributionProfileDocumentLocalId,
  hydrateExplorerAttributionProfileDocuments,
  loadExplorerAttributionDirectoryAndGroups,
  MAX_EXPLORER_ATTRIBUTION_HYDRATION_DOCUMENTS,
  MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS,
  selectExplorerAttributionProfileHydrationTargets,
} from "./explorerAttributionReadModel";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

function rosterUser(input: {
  profileDocumentId: string | null;
  status?: "active" | "disabled" | undefined;
  userId: string;
}): OrganizationDirectoryUser {
  const disabled = input.status === "disabled";
  return {
    createdAt: "2026-08-25T12:00:00.000Z",
    disabledAt: disabled ? "2026-08-25T13:00:00.000Z" : null,
    disabledByUserId: disabled ? "admin-user-id" : null,
    encapsulationKeyFingerprint: `encapsulation-${input.userId}`,
    encapsulationPublicKey: `encapsulation-key-${input.userId}`,
    isSelf: false,
    joinedAt: "2026-08-25T12:00:00.000Z",
    profileDocumentId: input.profileDocumentId,
    signingKeyFingerprint: `signing-${input.userId}`,
    signingPublicKey: `signing-key-${input.userId}`,
    status: input.status ?? "active",
    updatedAt: "2026-08-25T13:00:00.000Z",
    userId: input.userId,
  };
}

function projection(input: {
  isOrgAdmin?: boolean | undefined;
  users: ReadonlyArray<OrganizationDirectoryUser>;
}): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: input.isOrgAdmin ?? true },
      organizationId: ORGANIZATION_ID,
      profileDocumentId: null,
      users: [...input.users],
    },
    groups: [],
    memberGroupId: "members-group-id",
    readModelCursor: "cursor-1",
  };
}

function readModel(cursor: string): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId: "organization-id",
      profileDocumentId: null,
      users: [],
    },
    groups: [],
    memberGroupId: "member-group-id",
    readModelCursor: cursor,
  };
}

test("Explorer attribution uses the local organization projection without reconciling", async () => {
  const local = readModel("local-cursor");
  const loadLocalDirectoryAndGroups = mock(() => Promise.resolve(local));

  const result = await loadExplorerAttributionDirectoryAndGroups({
    loadLocalDirectoryAndGroups,
  });

  expect(result).toBe(local);
  expect(loadLocalDirectoryAndGroups).toHaveBeenCalledTimes(1);
});

test("Explorer attribution leaves a cold miss to demand-scoped catch-up", async () => {
  const loadLocalDirectoryAndGroups = mock(() => Promise.resolve(null));

  const result = await loadExplorerAttributionDirectoryAndGroups({
    loadLocalDirectoryAndGroups,
  });

  expect(result).toBeNull();
  expect(loadLocalDirectoryAndGroups).toHaveBeenCalledTimes(1);
});

test("Explorer attribution consumes an authoritative purge without a second request", async () => {
  const loadLocalDirectoryAndGroups = mock(() =>
    Promise.resolve(readModel("stale-cursor")),
  );

  const result = await loadExplorerAttributionDirectoryAndGroups(
    { loadLocalDirectoryAndGroups },
    null,
  );

  expect(result).toBeNull();
  expect(loadLocalDirectoryAndGroups).toHaveBeenCalledTimes(0);
});

test("disabled contributors are retained and prioritized within the bound", () => {
  const active = rosterUser({
    profileDocumentId: "active-profile-id",
    userId: "active-user-id",
  });
  const disabled = rosterUser({
    profileDocumentId: "disabled-profile-id",
    status: "disabled",
    userId: "disabled-user-id",
  });

  expect(
    selectExplorerAttributionProfileHydrationTargets({
      contributorUserIds: [
        active.userId,
        disabled.userId,
        disabled.userId,
        "unknown-user-id",
      ],
      directoryAndGroups: projection({ users: [active, disabled] }),
      limit: 1,
    }),
  ).toEqual([
    {
      bindingKey: "disabled-user-id\0disabled-profile-id",
      profileDocumentId: "disabled-profile-id",
      userId: "disabled-user-id",
    },
  ]);
});

test("profile hydration is unavailable to non-admin viewers", () => {
  const user = rosterUser({
    profileDocumentId: "profile-id",
    userId: "user-id",
  });

  expect(
    selectExplorerAttributionProfileHydrationTargets({
      contributorUserIds: [user.userId],
      directoryAndGroups: projection({ isOrgAdmin: false, users: [user] }),
    }),
  ).toEqual([]);
});

test("profile hydration never exceeds the per-document cap", () => {
  const users = Array.from(
    { length: MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS + 8 },
    (_, index) =>
      rosterUser({
        profileDocumentId: `profile-${index}`,
        status: "disabled",
        userId: `user-${index}`,
      }),
  );

  const targets = selectExplorerAttributionProfileHydrationTargets({
    contributorUserIds: users.map((user) => user.userId),
    directoryAndGroups: projection({ users }),
    limit: Number.MAX_SAFE_INTEGER,
  });

  expect(targets).toHaveLength(MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS);
  expect(targets.at(-1)?.userId).toBe("user-31");
});

test("profile hydration evicts the least recently viewed document", () => {
  const selections = new Map<string, Set<string>>();
  for (
    let index = 0;
    index < MAX_EXPLORER_ATTRIBUTION_HYDRATION_DOCUMENTS;
    index += 1
  ) {
    getExplorerAttributionHydrationDocumentSelection(
      selections,
      `document-${index}`,
    );
  }
  getExplorerAttributionHydrationDocumentSelection(selections, "document-0");
  getExplorerAttributionHydrationDocumentSelection(selections, "overflow");

  expect(selections.size).toBe(MAX_EXPLORER_ATTRIBUTION_HYDRATION_DOCUMENTS);
  expect(selections.has("document-0")).toBe(true);
  expect(selections.has("document-1")).toBe(false);
});

test("profiles reserved by another document do not consume the hydration cap", () => {
  const users = Array.from(
    { length: MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS + 1 },
    (_, index) =>
      rosterUser({
        profileDocumentId: `profile-${index}`,
        status: "disabled",
        userId: `user-${index}`,
      }),
  );
  const reservedBindingKeys = new Set(
    users
      .slice(0, MAX_EXPLORER_ATTRIBUTION_PROFILE_HYDRATIONS)
      .map((user) => `${user.userId}\0${user.profileDocumentId}`),
  );

  expect(
    selectExplorerAttributionProfileHydrationTargets({
      contributorUserIds: users.map((user) => user.userId),
      directoryAndGroups: projection({ users }),
      excludedBindingKeys: reservedBindingKeys,
    }),
  ).toEqual([
    {
      bindingKey: "user-32\0profile-32",
      profileDocumentId: "profile-32",
      userId: "user-32",
    },
  ]);
});

test("cold and cached profiles open by retained identity and remote-probe", () => {
  const requestRemoteSync = mock(() => undefined);
  const open = mock(() => ({ requestRemoteSync }));

  const input = {
    containerId: "roster-profile-container-id",
    documents: { open } as unknown as Documents,
    organizationId: ORGANIZATION_ID,
    targets: [
      {
        bindingKey: "disabled-user-id\0disabled-profile-id",
        profileDocumentId: "disabled-profile-id",
        userId: "disabled-user-id",
      },
    ],
  };
  hydrateExplorerAttributionProfileDocuments(input);
  hydrateExplorerAttributionProfileDocuments(input);

  expect(open).toHaveBeenCalledWith({
    containerId: "roster-profile-container-id",
    documentId: "disabled-profile-id",
    localId: getExplorerAttributionProfileDocumentLocalId({
      organizationId: ORGANIZATION_ID,
      profileDocumentId: "disabled-profile-id",
      userId: "disabled-user-id",
    }),
  });
  expect(open).toHaveBeenCalledTimes(2);
  expect(requestRemoteSync).toHaveBeenCalledTimes(2);
});

test("profile pointer replacements hydrate through distinct local identities", () => {
  const syncedDocumentIds: string[] = [];
  const storesByLocalId = new Map<
    string,
    { documentId: string; requestRemoteSync: () => void }
  >();
  const open = mock(
    (input: { documentId?: string | null; localId?: string }) => {
      const localId = input.localId ?? "";
      const documentId = input.documentId ?? "";
      const existing = storesByLocalId.get(localId);
      if (existing) {
        return existing;
      }
      const store = {
        documentId,
        requestRemoteSync: () => syncedDocumentIds.push(documentId),
      };
      storesByLocalId.set(localId, store);
      return store;
    },
  );
  const documents = { open } as unknown as Documents;
  const target = (profileDocumentId: string) => ({
    bindingKey: `disabled-user-id\0${profileDocumentId}`,
    profileDocumentId,
    userId: "disabled-user-id",
  });

  hydrateExplorerAttributionProfileDocuments({
    containerId: "roster-profile-container-id",
    documents,
    organizationId: ORGANIZATION_ID,
    targets: [target("old-profile-id")],
  });
  hydrateExplorerAttributionProfileDocuments({
    containerId: "roster-profile-container-id",
    documents,
    organizationId: ORGANIZATION_ID,
    targets: [target("new-profile-id")],
  });

  expect(storesByLocalId.size).toBe(2);
  expect(syncedDocumentIds).toEqual(["old-profile-id", "new-profile-id"]);

  const currentUser = rosterUser({
    profileDocumentId: "new-profile-id",
    status: "disabled",
    userId: "disabled-user-id",
  });
  const currentBindings = getExplorerAttributionProfileBindingsByLocalId({
    directoryAndGroups: projection({ users: [currentUser] }),
    organizationId: ORGANIZATION_ID,
  });
  expect(
    getExplorerAttributionProfileDisplayNames({
      documents: {
        rows: [
          {
            containerId: "roster-profile-container-id",
            documentId: "old-profile-id",
            documentKind: "contact",
            id: getExplorerAttributionProfileDocumentLocalId({
              organizationId: ORGANIZATION_ID,
              profileDocumentId: "old-profile-id",
              userId: "disabled-user-id",
            }),
            title: "Stale Name",
            updatedAt: "2026-08-25T13:00:00.000Z",
          },
          {
            containerId: "roster-profile-container-id",
            documentId: "new-profile-id",
            documentKind: "contact",
            id: getExplorerAttributionProfileDocumentLocalId({
              organizationId: ORGANIZATION_ID,
              profileDocumentId: "new-profile-id",
              userId: "disabled-user-id",
            }),
            title: "Current Name",
            updatedAt: "2026-08-25T14:00:00.000Z",
          },
        ],
        totalCount: 2,
      },
      profileBindingsByLocalId: currentBindings,
    }),
  ).toEqual(new Map([["disabled-user-id", "Current Name"]]));
});

test("the newest current profile copy supplies the attribution name", () => {
  const user = rosterUser({
    profileDocumentId: "current-profile-id",
    status: "disabled",
    userId: "disabled-user-id",
  });
  const bindings = getExplorerAttributionProfileBindingsByLocalId({
    directoryAndGroups: projection({ users: [user] }),
    organizationId: ORGANIZATION_ID,
  });
  const remoteLocalId = getExplorerAttributionProfileDocumentLocalId({
    organizationId: ORGANIZATION_ID,
    profileDocumentId: "current-profile-id",
    userId: "disabled-user-id",
  });
  const canonicalLocalId = getRosterProfileDocumentLocalId({
    organizationId: ORGANIZATION_ID,
    userId: "disabled-user-id",
  });

  expect(
    getExplorerAttributionProfileDisplayNames({
      documents: {
        rows: [
          {
            containerId: "roster-profile-container-id",
            documentId: "current-profile-id",
            documentKind: "contact",
            id: remoteLocalId,
            title: "Current Name",
            updatedAt: "2026-08-25T14:00:00.000Z",
          },
          {
            containerId: "roster-profile-container-id",
            documentId: "current-profile-id",
            documentKind: "contact",
            id: canonicalLocalId,
            title: "Older Name",
            updatedAt: "2026-08-25T13:00:00.000Z",
          },
        ],
        totalCount: 2,
      },
      profileBindingsByLocalId: bindings,
    }),
  ).toEqual(new Map([["disabled-user-id", "Current Name"]]));
});

import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  type DocumentSummary,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryAndGroups,
  type OrganizationDirectoryUser,
  type PersistedDocumentListener,
} from "@symcrypt/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import * as SymCryptProvider from "../../../providers/sdk/SymCryptProvider";
import { useExplorerAttributionUserLabels } from "./useExplorerAttributionUserLabels";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_USER_ID = "00000000-0000-4000-8000-000000000002";
const FIRST_PROFILE_ID = "00000000-0000-4000-8000-000000000003";
const SECOND_PROFILE_ID = "00000000-0000-4000-8000-000000000004";

afterEach(() => cleanup());

function rosterUser(input: {
  profileDocumentId: string;
  userId: string;
}): OrganizationDirectoryUser {
  return {
    createdAt: "2026-05-20T12:00:00.000Z",
    disabledAt: null,
    disabledByUserId: null,
    encapsulationKeyFingerprint: `encapsulation-${input.userId}`,
    encapsulationPublicKey: `encapsulation-key-${input.userId}`,
    isSelf: false,
    joinedAt: "2026-05-20T12:00:00.000Z",
    profileDocumentId: input.profileDocumentId,
    signingKeyFingerprint: `signing-${input.userId}`,
    signingPublicKey: `signing-key-${input.userId}`,
    status: "active",
    updatedAt: "2026-05-20T12:00:00.000Z",
    userId: input.userId,
  };
}

function projection(
  users: OrganizationDirectoryUser[],
  cursor: string,
): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId: ORGANIZATION_ID,
      profileDocumentId: null,
      users,
    },
    groups: [],
    memberGroupId: "members-group-id",
    readModelCursor: cursor,
  };
}

function runtimeSnapshot(input: {
  dbStatus?: string;
  domainScope: object;
  isAuthenticated?: boolean;
  userId: string;
}) {
  return {
    auth: {
      authToken: "token",
      isAuthenticated: input.isAuthenticated ?? true,
      organizationId: ORGANIZATION_ID,
      userId: input.userId,
    },
    infra: { dbStatus: input.dbStatus ?? "ready" },
    state: { domainScope: input.domainScope },
  } as unknown as RuntimeSnapshot;
}

function profileSummary(input: {
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

function createSymCryptHarness(input?: {
  rows?: ReadonlyArray<DocumentSummary>;
}) {
  let rows = input?.rows ?? [];
  const listeners = new Set<PersistedDocumentListener>();
  const requestSync = mock(() => undefined);
  const open = mock(() => ({ requestSync }));
  const list = mock(() => Promise.resolve({ rows, totalCount: rows.length }));
  const subscribe = mock((listener: PersistedDocumentListener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const loadLocalDirectoryAndGroups = mock(() => Promise.resolve(null));
  const loadDirectoryAndGroups = mock(() => Promise.resolve(null));
  const logError = mock(() => undefined);
  const symcrypt = {
    documents: { list, open, subscribe },
    logError,
    organizations: {
      loadDirectoryAndGroups,
      loadLocalDirectoryAndGroups,
    },
  } as unknown as ReturnType<typeof SymCryptProvider.useSymCrypt>;
  return {
    emit(document: DocumentSummary) {
      rows = [...rows.filter((row) => row.id !== document.id), document];
      for (const listener of listeners) {
        listener(document);
      }
    },
    list,
    loadDirectoryAndGroups,
    loadLocalDirectoryAndGroups,
    logError,
    open,
    requestSync,
    subscribe,
    symcrypt,
  };
}

test("59 cold roster profiles cause one local query and zero hydration fanout", async () => {
  const users = Array.from({ length: 59 }, (_, index) =>
    rosterUser({
      profileDocumentId: `profile-${index}`,
      userId: `profile-user-${index}`,
    }),
  );
  const harness = createSymCryptHarness();
  const useSymCryptSpy = spyOn(
    SymCryptProvider,
    "useSymCrypt",
  ).mockImplementation(() => harness.symcrypt);
  const appData = runtimeSnapshot({
    domainScope: {},
    userId: "viewer-user-id",
  });

  try {
    const view = renderHook(() =>
      useExplorerAttributionUserLabels({
        appData,
        enabled: true,
        readModelProjection: projection(users, "cursor-1"),
        readModelRevision: 1,
      }),
    );
    await waitFor(() => expect(harness.list).toHaveBeenCalledTimes(1));

    expect(harness.list).toHaveBeenCalledWith({ documentKind: "contact" });
    expect(view.result.current(users[0]?.userId)).toBeNull();
    expect(harness.open).toHaveBeenCalledTimes(0);
    expect(harness.requestSync).toHaveBeenCalledTimes(0);
    expect(harness.loadLocalDirectoryAndGroups).toHaveBeenCalledTimes(0);
    expect(harness.loadDirectoryAndGroups).toHaveBeenCalledTimes(0);
  } finally {
    useSymCryptSpy.mockRestore();
  }
});

test("local profile updates repaint while group-only revisions do not reload", async () => {
  const user = rosterUser({
    profileDocumentId: FIRST_PROFILE_ID,
    userId: PROFILE_USER_ID,
  });
  const firstProjection = projection([user], "cursor-1");
  const harness = createSymCryptHarness({
    rows: [
      profileSummary({
        profileDocumentId: FIRST_PROFILE_ID,
        title: "Profile User",
        userId: PROFILE_USER_ID,
      }),
    ],
  });
  const useSymCryptSpy = spyOn(
    SymCryptProvider,
    "useSymCrypt",
  ).mockImplementation(() => harness.symcrypt);
  const appData = runtimeSnapshot({
    domainScope: {},
    userId: "viewer-user-id",
  });

  try {
    const view = renderHook(
      (props: {
        enabled: boolean;
        projection: OrganizationDirectoryAndGroups | null;
        revision: number;
      }) =>
        useExplorerAttributionUserLabels({
          appData,
          enabled: props.enabled,
          readModelProjection: props.projection,
          readModelRevision: props.revision,
        }),
      {
        initialProps: {
          enabled: true,
          projection: firstProjection,
          revision: 1,
        },
      },
    );
    await waitFor(() =>
      expect(view.result.current(PROFILE_USER_ID)).toBe("Profile User"),
    );

    view.rerender({
      enabled: true,
      projection: {
        ...firstProjection,
        groups: [
          {
            createdAt: "2026-05-20T12:00:00.000Z",
            currentState: null,
            groupId: "group-id",
            isBuiltin: false,
            name: "Writers",
            organizationId: ORGANIZATION_ID,
          },
        ],
        readModelCursor: "cursor-2",
      },
      revision: 2,
    });
    await act(async () => Promise.resolve());
    expect(harness.list).toHaveBeenCalledTimes(1);

    act(() => {
      harness.emit(
        profileSummary({
          profileDocumentId: FIRST_PROFILE_ID,
          title: "Updated Profile",
          userId: PROFILE_USER_ID,
        }),
      );
    });
    await waitFor(() =>
      expect(view.result.current(PROFILE_USER_ID)).toBe("Updated Profile"),
    );
    expect(harness.list).toHaveBeenCalledTimes(2);
  } finally {
    useSymCryptSpy.mockRestore();
  }
});

test("profile binding changes reject stale local rows and roster removal clears", async () => {
  const firstUser = rosterUser({
    profileDocumentId: FIRST_PROFILE_ID,
    userId: PROFILE_USER_ID,
  });
  const harness = createSymCryptHarness({
    rows: [
      profileSummary({
        profileDocumentId: FIRST_PROFILE_ID,
        title: "Stale Profile",
        userId: PROFILE_USER_ID,
      }),
    ],
  });
  const useSymCryptSpy = spyOn(
    SymCryptProvider,
    "useSymCrypt",
  ).mockImplementation(() => harness.symcrypt);
  const appData = runtimeSnapshot({
    domainScope: {},
    userId: "viewer-user-id",
  });

  try {
    const view = renderHook(
      (props: {
        enabled: boolean;
        projection: OrganizationDirectoryAndGroups | null;
        revision: number;
      }) =>
        useExplorerAttributionUserLabels({
          appData,
          enabled: props.enabled,
          readModelProjection: props.projection,
          readModelRevision: props.revision,
        }),
      {
        initialProps: {
          enabled: true,
          projection: projection(
            [firstUser],
            "cursor-1",
          ) as OrganizationDirectoryAndGroups | null,
          revision: 1,
        },
      },
    );
    await waitFor(() =>
      expect(view.result.current(PROFILE_USER_ID)).toBe("Stale Profile"),
    );

    view.rerender({
      enabled: true,
      projection: projection(
        [
          rosterUser({
            profileDocumentId: SECOND_PROFILE_ID,
            userId: PROFILE_USER_ID,
          }),
        ],
        "cursor-2",
      ),
      revision: 2,
    });
    await waitFor(() => expect(harness.list).toHaveBeenCalledTimes(2));
    expect(view.result.current(PROFILE_USER_ID)).toBeNull();

    act(() => {
      harness.emit(
        profileSummary({
          profileDocumentId: SECOND_PROFILE_ID,
          title: "Current Profile",
          userId: PROFILE_USER_ID,
        }),
      );
    });
    await waitFor(() =>
      expect(view.result.current(PROFILE_USER_ID)).toBe("Current Profile"),
    );

    view.rerender({
      enabled: false,
      projection: projection(
        [
          rosterUser({
            profileDocumentId: SECOND_PROFILE_ID,
            userId: PROFILE_USER_ID,
          }),
        ],
        "cursor-2",
      ),
      revision: 2,
    });
    expect(view.result.current(PROFILE_USER_ID)).toBeNull();

    view.rerender({
      enabled: true,
      projection: projection(
        [
          rosterUser({
            profileDocumentId: SECOND_PROFILE_ID,
            userId: PROFILE_USER_ID,
          }),
        ],
        "cursor-2",
      ),
      revision: 2,
    });
    await waitFor(() =>
      expect(view.result.current(PROFILE_USER_ID)).toBe("Current Profile"),
    );

    view.rerender({
      enabled: true,
      projection: projection([], "cursor-3"),
      revision: 3,
    });
    expect(view.result.current(PROFILE_USER_ID)).toBeNull();

    view.rerender({ enabled: true, projection: null, revision: 4 });
    expect(view.result.current(PROFILE_USER_ID)).toBeNull();
    act(() => {
      harness.emit(
        profileSummary({
          profileDocumentId: SECOND_PROFILE_ID,
          title: "Must Stay Hidden",
          userId: PROFILE_USER_ID,
        }),
      );
    });
    await act(async () => Promise.resolve());
    expect(harness.list).toHaveBeenCalledTimes(4);
  } finally {
    useSymCryptSpy.mockRestore();
  }
});

test("auth, database, identity, and domain transitions never render stale names", async () => {
  const user = rosterUser({
    profileDocumentId: FIRST_PROFILE_ID,
    userId: PROFILE_USER_ID,
  });
  const harness = createSymCryptHarness({
    rows: [
      profileSummary({
        profileDocumentId: FIRST_PROFILE_ID,
        title: "Scoped Profile",
        userId: PROFILE_USER_ID,
      }),
    ],
  });
  const useSymCryptSpy = spyOn(
    SymCryptProvider,
    "useSymCrypt",
  ).mockImplementation(() => harness.symcrypt);
  const firstScope = {};
  const readModelProjection = projection([user], "cursor-1");

  try {
    const view = renderHook(
      (appData: RuntimeSnapshot) =>
        useExplorerAttributionUserLabels({
          appData,
          enabled: true,
          readModelProjection,
          readModelRevision: 1,
        }),
      {
        initialProps: runtimeSnapshot({
          domainScope: firstScope,
          userId: "viewer-a",
        }),
      },
    );
    await waitFor(() =>
      expect(view.result.current(PROFILE_USER_ID)).toBe("Scoped Profile"),
    );

    view.rerender(
      runtimeSnapshot({
        domainScope: firstScope,
        isAuthenticated: false,
        userId: "viewer-a",
      }),
    );
    expect(view.result.current(PROFILE_USER_ID)).toBeNull();

    view.rerender(
      runtimeSnapshot({
        dbStatus: "loading",
        domainScope: firstScope,
        userId: "viewer-b",
      }),
    );
    expect(view.result.current(PROFILE_USER_ID)).toBeNull();

    view.rerender(runtimeSnapshot({ domainScope: {}, userId: "viewer-b" }));
    expect(view.result.current(PROFILE_USER_ID)).toBeNull();
    await waitFor(() =>
      expect(view.result.current(PROFILE_USER_ID)).toBe("Scoped Profile"),
    );
    expect(harness.list).toHaveBeenCalledTimes(2);
  } finally {
    useSymCryptSpy.mockRestore();
  }
});

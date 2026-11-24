import { afterEach, expect, test } from "bun:test";
import {
  getRosterProfileDocumentLocalId,
  type OrganizationDirectory,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import {
  getLocalRosterProfileDisplayNames,
  getRosterProfileBindingsByLocalId,
} from "../../../stores/org-manager/rosterProfileDisplayNames";
import { useOrgManagerProfileDisplayNames } from "./useOrgManagerProfileDisplayNames";
import {
  createTearleadsHarness,
  directory,
  findNoRosterProfileContainer,
  ORGANIZATION_ID,
  PROFILE_DOCUMENT_ID,
  profileSummary,
  rosterUser,
  runtime,
  SECOND_PROFILE_DOCUMENT_ID,
  USER_ID,
} from "./useOrgManagerProfileDisplayNames.testUtils";

afterEach(() => cleanup());

test("59 roster profiles use one local query and no fanout without a listed container", async () => {
  const users = Array.from({ length: 59 }, (_, index) =>
    rosterUser({
      profileDocumentId: `profile-document-${index}`,
      userId: `profile-user-${index}`,
    }),
  );
  const harness = createTearleadsHarness();
  const selectedUserIdRef = { current: users[0]?.userId ?? null };
  const appData = runtime();
  const view = renderHook(
    (activeDirectory: OrganizationDirectory | null) =>
      useOrgManagerProfileDisplayNames({
        appData,
        canLoadAuthenticatedOrgData: true,
        directory: activeDirectory,
        findRosterProfileContainer: findNoRosterProfileContainer,
        selectedUserIdRef,
        tearleads: harness.tearleads,
      }),
    { initialProps: directory(users) as OrganizationDirectory | null },
  );
  await waitFor(() => expect(harness.list).toHaveBeenCalledTimes(1));

  expect(harness.list).toHaveBeenCalledWith({ documentKind: "contact" });
  expect(view.result.current.profileDisplayNamesByUserId).toEqual(new Map());
  expect(harness.subscribe).toHaveBeenCalledTimes(1);
  expect(harness.open).toHaveBeenCalledTimes(0);
  expect(harness.requestSync).toHaveBeenCalledTimes(0);
  expect(harness.loadLocalDirectoryAndGroups).toHaveBeenCalledTimes(0);
  expect(harness.loadDirectoryAndGroups).toHaveBeenCalledTimes(0);

  view.rerender(directory(users.map((user) => ({ ...user }))));
  await act(async () => Promise.resolve());
  expect(harness.list).toHaveBeenCalledTimes(1);
  expect(harness.subscribe).toHaveBeenCalledTimes(1);
});

test("reused-store changes repaint and current bindings reject stale rows", async () => {
  const user = rosterUser({
    profileDocumentId: PROFILE_DOCUMENT_ID,
    userId: USER_ID,
  });
  const harness = createTearleadsHarness([
    profileSummary({
      profileDocumentId: PROFILE_DOCUMENT_ID,
      title: "First Name",
      userId: USER_ID,
    }),
  ]);
  const appData = runtime();
  const selectedUserIdRef = { current: USER_ID };
  const view = renderHook(
    (activeDirectory: OrganizationDirectory | null) =>
      useOrgManagerProfileDisplayNames({
        appData,
        canLoadAuthenticatedOrgData: true,
        directory: activeDirectory,
        findRosterProfileContainer: findNoRosterProfileContainer,
        selectedUserIdRef,
        tearleads: harness.tearleads,
      }),
    { initialProps: directory([user]) as OrganizationDirectory | null },
  );
  await waitFor(() =>
    expect(view.result.current.profileDisplayNamesByUserId.get(USER_ID)).toBe(
      "First Name",
    ),
  );

  act(() => {
    harness.emit(
      profileSummary({
        profileDocumentId: PROFILE_DOCUMENT_ID,
        title: "Updated Name",
        userId: USER_ID,
      }),
    );
  });
  await waitFor(() =>
    expect(view.result.current.profileDisplayNamesByUserId.get(USER_ID)).toBe(
      "Updated Name",
    ),
  );
  expect(harness.list).toHaveBeenCalledTimes(2);

  view.rerender(
    directory([
      rosterUser({
        profileDocumentId: SECOND_PROFILE_DOCUMENT_ID,
        userId: USER_ID,
      }),
    ]),
  );
  expect(view.result.current.profileDisplayNamesByUserId).toEqual(new Map());
  await waitFor(() => expect(harness.list).toHaveBeenCalledTimes(3));
  expect(view.result.current.profileDisplayNamesByUserId).toEqual(new Map());

  act(() => {
    harness.emit(
      profileSummary({
        profileDocumentId: SECOND_PROFILE_DOCUMENT_ID,
        title: "Current Binding",
        userId: USER_ID,
      }),
    );
  });
  await waitFor(() =>
    expect(view.result.current.profileDisplayNamesByUserId.get(USER_ID)).toBe(
      "Current Binding",
    ),
  );

  view.rerender(null);
  expect(view.result.current.profileDisplayNamesByUserId).toEqual(new Map());
  act(() => {
    harness.emit(
      profileSummary({
        profileDocumentId: SECOND_PROFILE_DOCUMENT_ID,
        title: "Must Stay Purged",
        userId: USER_ID,
      }),
    );
  });
  await act(async () => Promise.resolve());
  expect(harness.list).toHaveBeenCalledTimes(4);
});

test("scope loss clears names and selected-editor updates remain immediate", async () => {
  const user = rosterUser({
    profileDocumentId: PROFILE_DOCUMENT_ID,
    userId: USER_ID,
  });
  const harness = createTearleadsHarness([
    profileSummary({
      profileDocumentId: PROFILE_DOCUMENT_ID,
      title: "Scoped Name",
      userId: USER_ID,
    }),
  ]);
  const selectedUserIdRef = { current: USER_ID };
  const firstScope = {};
  const activeDirectory = directory([user]);
  const view = renderHook(
    (props: {
      appData: ReturnType<typeof useTearleadsRuntime>;
      canLoad: boolean;
      directory: OrganizationDirectory | null;
    }) =>
      useOrgManagerProfileDisplayNames({
        appData: props.appData,
        canLoadAuthenticatedOrgData: props.canLoad,
        directory: props.directory,
        findRosterProfileContainer: findNoRosterProfileContainer,
        selectedUserIdRef,
        tearleads: harness.tearleads,
      }),
    {
      initialProps: {
        appData: runtime({ domainScope: firstScope }),
        canLoad: true,
        directory: activeDirectory as OrganizationDirectory | null,
      },
    },
  );
  await waitFor(() =>
    expect(view.result.current.profileDisplayNamesByUserId.get(USER_ID)).toBe(
      "Scoped Name",
    ),
  );

  act(() => view.result.current.setSelectedProfileDisplayName(" Editor Name "));
  expect(view.result.current.profileDisplayNamesByUserId.get(USER_ID)).toBe(
    "Editor Name",
  );

  view.rerender({
    appData: runtime({
      domainScope: firstScope,
      isAuthenticated: false,
    }),
    canLoad: false,
    directory: activeDirectory,
  });
  expect(view.result.current.profileDisplayNamesByUserId).toEqual(new Map());

  view.rerender({
    appData: runtime({ dbStatus: "loading", domainScope: firstScope }),
    canLoad: true,
    directory: activeDirectory,
  });
  expect(view.result.current.profileDisplayNamesByUserId).toEqual(new Map());

  view.rerender({
    appData: runtime({ domainScope: {} }),
    canLoad: true,
    directory: activeDirectory,
  });
  expect(view.result.current.profileDisplayNamesByUserId).toEqual(new Map());
  await waitFor(() =>
    expect(view.result.current.profileDisplayNamesByUserId.get(USER_ID)).toBe(
      "Scoped Name",
    ),
  );
  expect(harness.list).toHaveBeenCalledTimes(2);
});

test("local roster names require the current remote binding", () => {
  const user = rosterUser({
    profileDocumentId: PROFILE_DOCUMENT_ID,
    userId: USER_ID,
  });
  const profileBindingsByLocalId = getRosterProfileBindingsByLocalId({
    organizationId: ORGANIZATION_ID,
    users: [user],
  });
  const localId = getRosterProfileDocumentLocalId({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
  });

  expect([...profileBindingsByLocalId]).toEqual([
    [
      localId,
      {
        canonicalLocalId: localId,
        profileDocumentId: PROFILE_DOCUMENT_ID,
        userId: USER_ID,
      },
    ],
  ]);
  expect(
    getLocalRosterProfileDisplayNames({
      documents: {
        rows: [
          {
            ...profileSummary({
              profileDocumentId: "stale-profile-document-id",
              title: "Stale name",
              userId: USER_ID,
            }),
            id: localId,
          },
        ],
        totalCount: 1,
      },
      profileBindingsByLocalId,
    }),
  ).toEqual(new Map());
  expect(
    getLocalRosterProfileDisplayNames({
      documents: {
        rows: [
          profileSummary({
            profileDocumentId: PROFILE_DOCUMENT_ID,
            title: "  Ada Lovelace  ",
            userId: USER_ID,
          }),
        ],
        totalCount: 1,
      },
      profileBindingsByLocalId,
    }),
  ).toEqual(new Map([[USER_ID, "Ada Lovelace"]]));
});

test("placeholder contact titles do not replace the roster user fallback", () => {
  const user = rosterUser({
    profileDocumentId: PROFILE_DOCUMENT_ID,
    userId: USER_ID,
  });
  const profileBindingsByLocalId = getRosterProfileBindingsByLocalId({
    organizationId: ORGANIZATION_ID,
    users: [user],
  });

  for (const title of ["", "Untitled contact", USER_ID]) {
    expect(
      getLocalRosterProfileDisplayNames({
        documents: {
          rows: [
            profileSummary({
              profileDocumentId: PROFILE_DOCUMENT_ID,
              title,
              userId: USER_ID,
            }),
          ],
          totalCount: 1,
        },
        profileBindingsByLocalId,
      }),
    ).toEqual(new Map());
  }
});

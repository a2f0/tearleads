import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  type DocumentList,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryAndGroups,
  type OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { useExplorerAttributionUserLabels } from "./useExplorerAttributionUserLabels";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_USER_ID = "00000000-0000-4000-8000-000000000002";
const PROFILE_ID = "00000000-0000-4000-8000-000000000003";

afterEach(() => cleanup());

function rosterUser(): OrganizationDirectoryUser {
  return {
    createdAt: "2026-05-20T12:00:00.000Z",
    disabledAt: null,
    disabledByUserId: null,
    encapsulationKeyFingerprint: "encapsulation-fingerprint",
    encapsulationPublicKey: "encapsulation-key",
    isSelf: false,
    joinedAt: "2026-05-20T12:00:00.000Z",
    profileDocumentId: PROFILE_ID,
    signingKeyFingerprint: "signing-fingerprint",
    signingPublicKey: "signing-key",
    status: "active",
    updatedAt: "2026-05-20T12:00:00.000Z",
    userId: PROFILE_USER_ID,
  };
}

function projection(): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId: ORGANIZATION_ID,
      profileDocumentId: null,
      users: [rosterUser()],
    },
    groups: [],
    memberGroupId: "members-group-id",
    readModelCursor: "cursor-1",
  };
}

function runtimeSnapshot(input?: { isAuthenticated?: boolean }) {
  return {
    auth: {
      authToken: "token",
      isAuthenticated: input?.isAuthenticated ?? true,
      organizationId: ORGANIZATION_ID,
      userId: "viewer-user-id",
    },
    infra: { dbStatus: "ready" },
    state: { domainScope: {} },
  } as unknown as RuntimeSnapshot;
}

function createTearleadsHarness(listDocuments: () => Promise<DocumentList>) {
  const list = mock(listDocuments);
  const open = mock(() => ({ requestSync: mock(() => undefined) }));
  const logError = mock(() => undefined);
  const tearleads = {
    documents: {
      list,
      open,
      subscribe: () => () => undefined,
    },
    logError,
    organizations: {
      loadDirectoryAndGroups: () => Promise.resolve(null),
      loadLocalDirectoryAndGroups: () => Promise.resolve(null),
    },
  } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>;
  return { list, logError, open, tearleads };
}

function profileDocumentList(title: string): DocumentList {
  return {
    rows: [
      {
        containerId: "local-profile-container",
        documentId: PROFILE_ID,
        documentKind: "contact",
        id: getRosterProfileDocumentLocalId({
          organizationId: ORGANIZATION_ID,
          userId: PROFILE_USER_ID,
        }),
        title,
        updatedAt: "2026-05-20T12:00:00.000Z",
      },
    ],
    totalCount: 1,
  };
}

test("a cancelled local query cannot publish stale names", async () => {
  let resolveList: (value: DocumentList) => void = () => undefined;
  const pendingList = new Promise<DocumentList>((resolve) => {
    resolveList = resolve;
  });
  const harness = createTearleadsHarness(() => pendingList);
  const useTearleadsSpy = spyOn(
    TearleadsProvider,
    "useTearleads",
  ).mockImplementation(() => harness.tearleads);
  const initialRuntime = runtimeSnapshot();

  try {
    const view = renderHook(
      (appData: RuntimeSnapshot) =>
        useExplorerAttributionUserLabels({
          appData,
          enabled: true,
          readModelProjection: projection(),
          readModelRevision: 1,
        }),
      { initialProps: initialRuntime },
    );
    await waitFor(() => expect(harness.list).toHaveBeenCalledTimes(1));
    view.rerender(runtimeSnapshot({ isAuthenticated: false }));
    await act(async () => {
      resolveList(profileDocumentList("Too Late"));
      await pendingList;
    });

    expect(view.result.current(PROFILE_USER_ID)).toBeNull();
    expect(harness.logError).toHaveBeenCalledTimes(0);
  } finally {
    useTearleadsSpy.mockRestore();
  }
});

test("a failed local query is contained and leaves attribution unnamed", async () => {
  const failure = new Error("local projection failed");
  const harness = createTearleadsHarness(() => Promise.reject(failure));
  const useTearleadsSpy = spyOn(
    TearleadsProvider,
    "useTearleads",
  ).mockImplementation(() => harness.tearleads);

  try {
    const view = renderHook(() =>
      useExplorerAttributionUserLabels({
        appData: runtimeSnapshot(),
        enabled: true,
        readModelProjection: projection(),
        readModelRevision: 1,
      }),
    );
    await waitFor(() => expect(harness.logError).toHaveBeenCalledTimes(1));

    expect(harness.logError).toHaveBeenCalledWith(
      "Failed to load local explorer attribution roster display names",
      failure,
    );
    expect(view.result.current(PROFILE_USER_ID)).toBeNull();
    expect(harness.open).toHaveBeenCalledTimes(0);
  } finally {
    useTearleadsSpy.mockRestore();
  }
});

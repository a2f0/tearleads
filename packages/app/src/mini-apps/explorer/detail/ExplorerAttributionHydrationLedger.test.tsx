import { beforeAll, expect, mock, spyOn, test } from "bun:test";
import type {
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@tearleads/client-sdk";
import { DATABASE_BUSY_RUN_LIMIT } from "@tearleads/client-sdk/sqlite";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import * as DeviceFirstProvider from "../../../stores/device-first/DeviceFirstProvider";
import { useExplorerAttributionProfileHydration } from "../hooks/useExplorerOrganizationPresentation";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const DOMAIN_SCOPE = {};
let rosterProfileSystemSlot: Awaited<
  ReturnType<typeof deriveOrganizationRosterProfileContainerSystemSlot>
>;

beforeAll(async () => {
  rosterProfileSystemSlot =
    await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: ORGANIZATION_ID,
    });
});

function rosterUser(index: number): OrganizationDirectoryUser {
  const userId = `profile-user-${index}`;
  return {
    createdAt: "2026-05-20T12:00:00.000Z",
    disabledAt: null,
    disabledByUserId: null,
    twoFactorRequired: false,
    encapsulationKeyFingerprint: `encapsulation-${userId}`,
    isPersonalOrganizationOwner: false,
    isSelf: false,
    joinedAt: "2026-05-20T12:00:00.000Z",
    leaveRequest: null,
    profileDocumentId: `profile-${index}`,
    signingKeyFingerprint: `signing-${userId}`,
    status: "active",
    updatedAt: "2026-05-20T12:00:00.000Z",
    userId,
  };
}

function projection(
  users: ReadonlyArray<OrganizationDirectoryUser>,
  cursor: string,
): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId: ORGANIZATION_ID,
      profileDocumentId: null,
      users: [...users],
    },
    groups: [],
    memberGroupId: "members-group-id",
    readModelCursor: cursor,
  };
}

function runtimeSnapshot(): RuntimeSnapshot {
  return {
    auth: {
      authToken: "token",
      isAuthenticated: true,
      organizationId: ORGANIZATION_ID,
      userId: "viewer-user-id",
    },
    crypto: {
      encapsulationKeyPair: {},
      signingFingerprint: "viewer-signing-fingerprint",
      signingKeyPair: {},
    },
    infra: { dbStatus: "ready" },
    state: {
      containerId: "root-container-id",
      domainScope: DOMAIN_SCOPE,
      online: true,
    },
  } as unknown as RuntimeSnapshot;
}

function installAttributionHarness(
  remoteSync: (documentId: string) => Promise<boolean>,
) {
  const logged: string[] = [];
  const reported: unknown[] = [];
  const findLocalIdByDocumentId = mock(async () => null);
  const open = mock((input: { documentId?: string | null }) => ({
    requestRemoteSyncAndWait: () => remoteSync(input.documentId ?? ""),
  }));
  const useTearleadsSpy = spyOn(
    TearleadsProvider,
    "useTearleads",
  ).mockImplementation(
    () =>
      ({
        documents: { findLocalIdByDocumentId, open },
        log: (message: string) => logged.push(message),
        logError: (_message: string, error: unknown) => reported.push(error),
      }) as unknown as ReturnType<typeof TearleadsProvider.useTearleads>,
  );
  const containerSnapshot = {
    nodes: [
      {
        id: "roster-profile-container",
        organizationId: ORGANIZATION_ID,
        parentId: "root-container-id",
        systemSlot: rosterProfileSystemSlot,
      },
    ],
    ready: true,
  };
  const containerStore = {
    getSnapshot: () => containerSnapshot,
    subscribe: () => () => undefined,
  } as unknown as ReturnType<
    typeof DeviceFirstProvider.useDeviceFirstContainerContents
  >["containerStore"];
  const useDeviceFirstSpy = spyOn(
    DeviceFirstProvider,
    "useDeviceFirstContainerContents",
  ).mockImplementation(
    () =>
      ({ containerStore }) as unknown as ReturnType<
        typeof DeviceFirstProvider.useDeviceFirstContainerContents
      >,
  );
  return {
    logged,
    open,
    reported,
    restore() {
      cleanup();
      useDeviceFirstSpy.mockRestore();
      useTearleadsSpy.mockRestore();
    },
  };
}

test("the contributor cap survives disablement and projection changes", async () => {
  const users = Array.from({ length: 33 }, (_, index) => rosterUser(index));
  const harness = installAttributionHarness(async (documentId) =>
    Boolean(documentId),
  );
  const { open } = harness;
  try {
    const appData = runtimeSnapshot();
    const view = renderHook(
      (props: {
        enabled: boolean;
        readModelProjection: OrganizationDirectoryAndGroups;
        revision: number;
      }) =>
        useExplorerAttributionProfileHydration({
          appData,
          enabled: props.enabled,
          readModelProjection: props.readModelProjection,
          readModelRevision: props.revision,
        }),
      {
        initialProps: {
          enabled: true,
          readModelProjection: projection(users, "cursor-1"),
          revision: 1,
        },
      },
    );
    act(() =>
      view.result.current({
        contributorUserIds: users.slice(0, 32).map((user) => user.userId),
        documentId: "document-a",
      }),
    );
    await waitFor(() => expect(open).toHaveBeenCalledTimes(32));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    view.rerender({
      enabled: false,
      readModelProjection: projection(users, "cursor-1"),
      revision: 1,
    });
    view.rerender({
      enabled: true,
      readModelProjection: projection(users, "cursor-1"),
      revision: 1,
    });
    act(() =>
      view.result.current({
        contributorUserIds: [users[32]?.userId ?? ""],
        documentId: "document-a",
      }),
    );
    await waitFor(() => expect(open).toHaveBeenCalledTimes(64));
    expect(open).not.toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "profile-32" }),
    );

    const revisedUsers = users.map((user, index) =>
      index === 0 ? { ...user, profileDocumentId: "profile-0-next" } : user,
    );
    view.rerender({
      enabled: true,
      readModelProjection: projection(revisedUsers, "cursor-2"),
      revision: 2,
    });
    act(() =>
      view.result.current({
        contributorUserIds: [users[32]?.userId ?? ""],
        documentId: "document-a",
      }),
    );
    await waitFor(() => expect(open).toHaveBeenCalledTimes(96));
    expect(open).not.toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "profile-32" }),
    );
  } finally {
    harness.restore();
  }
});

// #3360: a pull the worker refuses behind another tab's transaction used to
// spend all three attempts at once and keep the profile reserved for the
// rest of the scope, so its attribution never resolved.
test("a profile refused as busy spends no attempt and is requested again", async () => {
  const pulls = new Map<string, number>();
  const harness = installAttributionHarness(async (documentId) => {
    pulls.set(documentId, (pulls.get(documentId) ?? 0) + 1);
    if (documentId === "profile-1") {
      throw new Error(DATABASE_TRANSACTION_BUSY_MESSAGE);
    }
    return true;
  });
  try {
    const view = renderHook(() =>
      useExplorerAttributionProfileHydration({
        appData: runtimeSnapshot(),
        enabled: true,
        readModelProjection: projection(
          [rosterUser(0), rosterUser(1)],
          "cursor-1",
        ),
        readModelRevision: 1,
      }),
    );
    const request = () =>
      act(() =>
        view.result.current({
          contributorUserIds: ["profile-user-0", "profile-user-1"],
          documentId: "document-a",
        }),
      );

    request();
    await waitFor(
      () => expect(pulls.get("profile-1")).toBe(DATABASE_BUSY_RUN_LIMIT),
      { timeout: 3_000 },
    );
    await act(async () => Promise.resolve());
    request();
    await waitFor(
      () => expect(pulls.get("profile-1")).toBe(2 * DATABASE_BUSY_RUN_LIMIT),
      { timeout: 3_000 },
    );
    expect(pulls.get("profile-0")).toBe(1);
    // Refusals stay in the local log and out of diagnostics.
    expect(harness.logged).toHaveLength(2);
    expect(harness.reported).toEqual([]);
  } finally {
    harness.restore();
  }
});

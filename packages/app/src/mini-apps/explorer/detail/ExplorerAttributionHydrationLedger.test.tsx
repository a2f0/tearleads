import { beforeAll, expect, mock, spyOn, test } from "bun:test";
import type {
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
} from "@symcrypt/client-sdk";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@symcrypt/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import * as SymCryptProvider from "../../../providers/sdk/SymCryptProvider";
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
    encapsulationKeyFingerprint: `encapsulation-${userId}`,
    encapsulationPublicKey: `encapsulation-key-${userId}`,
    isSelf: false,
    joinedAt: "2026-05-20T12:00:00.000Z",
    profileDocumentId: `profile-${index}`,
    signingKeyFingerprint: `signing-${userId}`,
    signingPublicKey: `signing-key-${userId}`,
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

test("the contributor cap survives disablement and projection changes", async () => {
  const users = Array.from({ length: 33 }, (_, index) => rosterUser(index));
  const findLocalIdByDocumentId = mock(async () => null);
  const open = mock((input: { documentId?: string | null }) => ({
    requestRemoteSyncAndWait: async () => Boolean(input.documentId),
  }));
  const useSymCryptSpy = spyOn(
    SymCryptProvider,
    "useSymCrypt",
  ).mockImplementation(
    () =>
      ({
        documents: { findLocalIdByDocumentId, open },
        logError: () => undefined,
      }) as unknown as ReturnType<typeof SymCryptProvider.useSymCrypt>,
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
    cleanup();
    useDeviceFirstSpy.mockRestore();
    useSymCryptSpy.mockRestore();
  }
});

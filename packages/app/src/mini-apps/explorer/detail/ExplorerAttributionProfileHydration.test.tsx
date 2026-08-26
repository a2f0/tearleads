import { beforeAll, expect, mock, spyOn, test } from "bun:test";
import type {
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
} from "@symcrypt/client-sdk";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@symcrypt/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import * as SymCryptProvider from "../../../providers/sdk/SymCryptProvider";
import * as DeviceFirstProvider from "../../../stores/device-first/DeviceFirstProvider";
import { useExplorerAttributionProfileHydration } from "../hooks/useExplorerOrganizationPresentation";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000002";
const ROOT_CONTAINER_ID = "root-container-id";
let rosterProfileSystemSlot: Awaited<
  ReturnType<typeof deriveOrganizationRosterProfileContainerSystemSlot>
>;

beforeAll(async () => {
  rosterProfileSystemSlot =
    await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: ORGANIZATION_ID,
    });
});

function rosterUser(
  index: number,
  status: "active" | "disabled" = "active",
): OrganizationDirectoryUser {
  const userId = `profile-user-${index}`;
  const disabled = status === "disabled";
  return {
    createdAt: "2026-05-20T12:00:00.000Z",
    disabledAt: disabled ? "2026-05-21T12:00:00.000Z" : null,
    disabledByUserId: disabled ? "viewer-user-id" : null,
    encapsulationKeyFingerprint: `encapsulation-${userId}`,
    encapsulationPublicKey: `encapsulation-key-${userId}`,
    isSelf: false,
    joinedAt: "2026-05-20T12:00:00.000Z",
    profileDocumentId: `profile-${index}`,
    signingKeyFingerprint: `signing-${userId}`,
    signingPublicKey: `signing-key-${userId}`,
    status,
    updatedAt: "2026-05-20T12:00:00.000Z",
    userId,
  };
}

function projection(
  users: ReadonlyArray<OrganizationDirectoryUser>,
  organizationId = ORGANIZATION_ID,
): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId,
      profileDocumentId: null,
      users: [...users],
    },
    groups: [],
    memberGroupId: "members-group-id",
    readModelCursor: "cursor-1",
  };
}

function runtimeSnapshot(
  organizationId = ORGANIZATION_ID,
  containerId = ROOT_CONTAINER_ID,
  syncPrerequisitesReady = true,
): RuntimeSnapshot {
  return {
    auth: {
      authToken: "token",
      isAuthenticated: true,
      organizationId,
      userId: "viewer-user-id",
    },
    crypto: {
      encapsulationKeyPair: syncPrerequisitesReady ? {} : null,
      signingFingerprint: "viewer-signing-fingerprint",
      signingKeyPair: {},
    },
    infra: { dbStatus: "ready" },
    state: { containerId, domainScope: {}, online: syncPrerequisitesReady },
  } as unknown as RuntimeSnapshot;
}

function createSymCryptHarness(
  remoteSync: (documentId: string) => Promise<boolean> = async () => true,
) {
  const requestRemoteSyncAndWait = mock(remoteSync);
  const open = mock((input: { documentId?: string | null }) => ({
    requestRemoteSyncAndWait: () =>
      requestRemoteSyncAndWait(input.documentId ?? ""),
  }));
  const symcrypt = {
    documents: { open },
    logError: mock(() => undefined),
  } as unknown as ReturnType<typeof SymCryptProvider.useSymCrypt>;
  return { open, requestRemoteSyncAndWait, symcrypt };
}

function createContainerStoreHarness(initiallyReady: boolean) {
  let containerAvailable = initiallyReady;
  let snapshot = {
    nodes: containerAvailable
      ? [
          {
            id: "roster-profile-container",
            organizationId: ORGANIZATION_ID,
            parentId: ROOT_CONTAINER_ID,
            systemSlot: rosterProfileSystemSlot,
          },
        ]
      : [],
    ready: initiallyReady,
  };
  const listeners = new Set<() => void>();
  const ensureSystemContainer = mock(() =>
    Promise.resolve(
      snapshot.ready && containerAvailable
        ? { id: "roster-profile-container" }
        : null,
    ),
  );
  const containerStore = {
    ensureSystemContainer,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as ReturnType<
    typeof DeviceFirstProvider.useDeviceFirstContainerContents
  >["containerStore"];
  return {
    containerStore,
    ensureSystemContainer,
    setContainerAvailable(available: boolean) {
      containerAvailable = available;
      snapshot = {
        ...snapshot,
        nodes: available
          ? [
              {
                id: "roster-profile-container",
                organizationId: ORGANIZATION_ID,
                parentId: ROOT_CONTAINER_ID,
                systemSlot: rosterProfileSystemSlot,
              },
            ]
          : [],
      };
      for (const listener of listeners) listener();
    },
    setReady(ready: boolean) {
      containerAvailable = ready;
      snapshot = {
        nodes: ready
          ? [
              {
                id: "roster-profile-container",
                organizationId: ORGANIZATION_ID,
                parentId: ROOT_CONTAINER_ID,
                systemSlot: rosterProfileSystemSlot,
              },
            ]
          : [],
        ready,
      };
      for (const listener of listeners) listener();
    },
  };
}
function installHarnesses(
  initiallyReady: boolean,
  remoteSync?: (documentId: string) => Promise<boolean>,
) {
  const symcrypt = createSymCryptHarness(remoteSync);
  const containers = createContainerStoreHarness(initiallyReady);
  const useSymCryptSpy = spyOn(
    SymCryptProvider,
    "useSymCrypt",
  ).mockImplementation(() => symcrypt.symcrypt);
  const useDeviceFirstSpy = spyOn(
    DeviceFirstProvider,
    "useDeviceFirstContainerContents",
  ).mockImplementation(
    () =>
      ({ containerStore: containers.containerStore }) as unknown as ReturnType<
        typeof DeviceFirstProvider.useDeviceFirstContainerContents
      >,
  );
  return {
    containers,
    restore() {
      cleanup();
      useDeviceFirstSpy.mockRestore();
      useSymCryptSpy.mockRestore();
    },
    symcrypt,
  };
}
test("attribution hydration retries as prerequisites become ready", async () => {
  const harness = installHarnesses(false);
  let appData = runtimeSnapshot(ORGANIZATION_ID, ROOT_CONTAINER_ID, false);
  try {
    const view = renderHook(() => {
      const requestHydration = useExplorerAttributionProfileHydration({
        appData,
        enabled: true,
        readModelProjection: projection([rosterUser(0)]),
        readModelRevision: 1,
      });
      useEffect(() => {
        requestHydration({
          contributorUserIds: ["profile-user-0"],
          documentId: "selected-document-id",
        });
      }, [requestHydration]);
    });
    await act(async () => Promise.resolve());
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(0);
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(0);
    act(() => harness.containers.setReady(true));
    await act(async () => Promise.resolve());
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(0);
    appData = runtimeSnapshot();
    view.rerender();
    await waitFor(() => expect(harness.symcrypt.open).toHaveBeenCalledTimes(1));
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(0);
    expect(harness.symcrypt.requestRemoteSyncAndWait).toHaveBeenCalledTimes(1);
  } finally {
    harness.restore();
  }
});
test("attribution hydration retries when a ready store gains its system container", async () => {
  const harness = installHarnesses(true);
  harness.containers.setContainerAvailable(false);
  const appData = runtimeSnapshot();
  const readModelProjection = projection([rosterUser(0)]);
  try {
    renderHook(() => {
      const requestHydration = useExplorerAttributionProfileHydration({
        appData,
        enabled: true,
        readModelProjection,
        readModelRevision: 1,
      });
      useEffect(() => {
        requestHydration({
          contributorUserIds: ["profile-user-0"],
          documentId: "selected-document-id",
        });
      }, [requestHydration]);
    });
    await act(async () => Promise.resolve());
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(0);
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(0);
    act(() => harness.containers.setContainerAvailable(true));
    await waitFor(() => expect(harness.symcrypt.open).toHaveBeenCalledTimes(1));
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(0);
    expect(harness.symcrypt.requestRemoteSyncAndWait).toHaveBeenCalledTimes(1);
  } finally {
    harness.restore();
  }
});
test("each document keeps its own bounded attribution hydration selection", async () => {
  const users = Array.from({ length: 65 }, (_, index) => rosterUser(index));
  const harness = installHarnesses(true);
  try {
    const view = renderHook(() =>
      useExplorerAttributionProfileHydration({
        appData: runtimeSnapshot(),
        enabled: true,
        readModelProjection: projection(users),
        readModelRevision: 1,
      }),
    );
    const contributorUserIds = users.map((user) => user.userId);
    act(() =>
      view.result.current({ contributorUserIds, documentId: "document-a" }),
    );
    await waitFor(() =>
      expect(harness.symcrypt.open).toHaveBeenCalledTimes(32),
    );
    act(() =>
      view.result.current({ contributorUserIds, documentId: "document-a" }),
    );
    await act(async () => Promise.resolve());
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(32);
    act(() =>
      view.result.current({
        contributorUserIds: contributorUserIds.slice(0, 33),
        documentId: "document-b",
      }),
    );
    await act(async () => Promise.resolve());
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(32);
    act(() =>
      view.result.current({ contributorUserIds, documentId: "document-a" }),
    );
    await act(async () => Promise.resolve());
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(32);
  } finally {
    harness.restore();
  }
});
test("a shared profile retains its slot in a full hydration selection", async () => {
  const harness = installHarnesses(true);
  const users = Array.from({ length: 33 }, (_, index) => rosterUser(index));
  try {
    const view = renderHook(() =>
      useExplorerAttributionProfileHydration({
        appData: runtimeSnapshot(),
        enabled: true,
        readModelProjection: projection(users),
        readModelRevision: 1,
      }),
    );
    act(() =>
      view.result.current({
        contributorUserIds: ["profile-user-0"],
        documentId: "document-a",
      }),
    );
    await waitFor(() => expect(harness.symcrypt.open).toHaveBeenCalledTimes(1));
    act(() =>
      view.result.current({
        contributorUserIds: users.map((user) => user.userId),
        documentId: "document-b",
      }),
    );
    await waitFor(() =>
      expect(harness.symcrypt.open).toHaveBeenCalledTimes(32),
    );
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(0);
    expect(harness.symcrypt.requestRemoteSyncAndWait).toHaveBeenCalledTimes(32);
    expect(harness.symcrypt.open).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "profile-0" }),
    );
    expect(harness.symcrypt.open).not.toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "profile-32" }),
    );
  } finally {
    harness.restore();
  }
});
test("an organization switch invalidates pending container resolution", async () => {
  const harness = installHarnesses(true);
  const user = rosterUser(0);
  try {
    const view = renderHook(
      (props: {
        appData: RuntimeSnapshot;
        readModelProjection: OrganizationDirectoryAndGroups;
      }) =>
        useExplorerAttributionProfileHydration({
          appData: props.appData,
          enabled: true,
          readModelProjection: props.readModelProjection,
          readModelRevision: 1,
        }),
      {
        initialProps: {
          appData: runtimeSnapshot(),
          readModelProjection: projection([user]),
        },
      },
    );
    act(() =>
      view.result.current({
        contributorUserIds: [user.userId],
        documentId: "document-a",
      }),
    );
    view.rerender({
      appData: runtimeSnapshot(OTHER_ORGANIZATION_ID, "other-root-id"),
      readModelProjection: projection([user], OTHER_ORGANIZATION_ID),
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(0);
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(0);
  } finally {
    harness.restore();
  }
});
test("unmount invalidates pending container resolution", async () => {
  const harness = installHarnesses(true);
  const user = rosterUser(0);
  try {
    const view = renderHook(() =>
      useExplorerAttributionProfileHydration({
        appData: runtimeSnapshot(),
        enabled: true,
        readModelProjection: projection([user]),
        readModelRevision: 1,
      }),
    );
    act(() =>
      view.result.current({
        contributorUserIds: [user.userId],
        documentId: "document-a",
      }),
    );
    view.unmount();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(0);
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(0);
  } finally {
    harness.restore();
  }
});
test("profile sync exhausts each binding once per hydration scope", async () => {
  const attemptsByDocumentId = new Map<string, number>();
  const harness = installHarnesses(true, async (documentId) => {
    const attempts = (attemptsByDocumentId.get(documentId) ?? 0) + 1;
    attemptsByDocumentId.set(documentId, attempts);
    return documentId === "profile-0" && attempts === 2;
  });
  try {
    const view = renderHook(() =>
      useExplorerAttributionProfileHydration({
        appData: runtimeSnapshot(),
        enabled: true,
        readModelProjection: projection([rosterUser(0), rosterUser(1)]),
        readModelRevision: 1,
      }),
    );
    act(() =>
      view.result.current({
        contributorUserIds: ["profile-user-0", "profile-user-1"],
        documentId: "document-a",
      }),
    );
    await waitFor(() => expect(attemptsByDocumentId.get("profile-1")).toBe(3));
    await act(async () => Promise.resolve());
    act(() =>
      view.result.current({
        contributorUserIds: ["profile-user-1"],
        documentId: "document-a",
      }),
    );
    await act(async () => Promise.resolve());
    expect(harness.symcrypt.requestRemoteSyncAndWait).toHaveBeenCalledTimes(5);
    expect(attemptsByDocumentId.get("profile-0")).toBe(2);
    expect(attemptsByDocumentId.get("profile-1")).toBe(3);
  } finally {
    harness.restore();
  }
});
test("a later-page disabled contributor cannot displace a selected profile", async () => {
  const harness = installHarnesses(true);
  const users = Array.from({ length: 33 }, (_, index) =>
    rosterUser(index, index === 32 ? "disabled" : "active"),
  );
  try {
    const view = renderHook(() =>
      useExplorerAttributionProfileHydration({
        appData: runtimeSnapshot(),
        enabled: true,
        readModelProjection: projection(users),
        readModelRevision: 1,
      }),
    );
    act(() =>
      view.result.current({
        contributorUserIds: users.slice(0, 32).map((user) => user.userId),
        documentId: "document-a",
      }),
    );
    await waitFor(() =>
      expect(harness.symcrypt.open).toHaveBeenCalledTimes(32),
    );
    act(() =>
      view.result.current({
        contributorUserIds: [users[32]?.userId ?? ""],
        documentId: "document-a",
      }),
    );
    await act(async () => Promise.resolve());
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(32);
  } finally {
    harness.restore();
  }
});

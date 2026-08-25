import { expect, mock, spyOn, test } from "bun:test";
import type {
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
} from "@symcrypt/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import * as SymCryptProvider from "../../../providers/sdk/SymCryptProvider";
import * as DeviceFirstProvider from "../../../stores/device-first/DeviceFirstProvider";
import { useExplorerAttributionProfileHydration } from "../hooks/useExplorerOrganizationPresentation";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

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
    readModelCursor: "cursor-1",
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
    infra: { dbStatus: "ready" },
    state: { domainScope: {} },
  } as unknown as RuntimeSnapshot;
}

function createSymCryptHarness() {
  const requestRemoteSync = mock(() => undefined);
  const open = mock(() => ({ requestRemoteSync }));
  const symcrypt = {
    documents: { open },
    logError: mock(() => undefined),
  } as unknown as ReturnType<typeof SymCryptProvider.useSymCrypt>;
  return { open, requestRemoteSync, symcrypt };
}

function createContainerStoreHarness(initiallyReady: boolean) {
  let containerAvailable = initiallyReady;
  let snapshot = {
    nodes: containerAvailable ? [{ id: "roster-profile-container" }] : [],
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
        nodes: available ? [{ id: "roster-profile-container" }] : [],
      };
      for (const listener of listeners) listener();
    },
    setReady(ready: boolean) {
      containerAvailable = ready;
      snapshot = {
        nodes: ready ? [{ id: "roster-profile-container" }] : [],
        ready,
      };
      for (const listener of listeners) listener();
    },
  };
}

function installHarnesses(initiallyReady: boolean) {
  const symcrypt = createSymCryptHarness();
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

test("attribution hydration retries when the container store becomes ready", async () => {
  const harness = installHarnesses(false);
  try {
    renderHook(() => {
      const requestHydration = useExplorerAttributionProfileHydration({
        appData: runtimeSnapshot(),
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
    await waitFor(() => expect(harness.symcrypt.open).toHaveBeenCalledTimes(1));
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(1);
    expect(harness.symcrypt.requestRemoteSync).toHaveBeenCalledTimes(1);
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
    await waitFor(() =>
      expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(1),
    );
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(0);

    act(() => harness.containers.setContainerAvailable(true));
    await waitFor(() => expect(harness.symcrypt.open).toHaveBeenCalledTimes(1));
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(2);
    expect(harness.symcrypt.requestRemoteSync).toHaveBeenCalledTimes(1);
  } finally {
    harness.restore();
  }
});

test("each document keeps one bounded attribution hydration selection", async () => {
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
  let resolveFirstEnsure: ((value: { id: string } | null) => void) | undefined;
  const firstEnsure = new Promise<{ id: string } | null>((resolve) => {
    resolveFirstEnsure = resolve;
  });
  harness.containers.ensureSystemContainer.mockImplementationOnce(
    () => firstEnsure,
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
        contributorUserIds: ["profile-user-0"],
        documentId: "document-a",
      }),
    );
    await waitFor(() =>
      expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(1),
    );

    act(() =>
      view.result.current({
        contributorUserIds: users.map((user) => user.userId),
        documentId: "document-b",
      }),
    );
    await waitFor(() =>
      expect(harness.symcrypt.open).toHaveBeenCalledTimes(31),
    );
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirstEnsure?.(null);
      await firstEnsure;
    });
    act(() =>
      view.result.current({
        contributorUserIds: users.map((user) => user.userId),
        documentId: "document-b",
      }),
    );
    await waitFor(() =>
      expect(harness.symcrypt.open).toHaveBeenCalledTimes(32),
    );
    expect(harness.containers.ensureSystemContainer).toHaveBeenCalledTimes(3);
    expect(harness.symcrypt.requestRemoteSync).toHaveBeenCalledTimes(32);
    expect(harness.symcrypt.open).not.toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "profile-32" }),
    );
  } finally {
    harness.restore();
  }
});

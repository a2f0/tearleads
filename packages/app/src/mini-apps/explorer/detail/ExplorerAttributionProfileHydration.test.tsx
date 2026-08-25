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
  const requestSync = mock(() => undefined);
  const open = mock(() => ({ requestSync }));
  const symcrypt = {
    documents: { open },
    logError: mock(() => undefined),
  } as unknown as ReturnType<typeof SymCryptProvider.useSymCrypt>;
  return { open, requestSync, symcrypt };
}

function createContainerStoreHarness(initiallyReady: boolean) {
  let snapshot = { nodes: [], ready: initiallyReady };
  const listeners = new Set<() => void>();
  const ensureSystemContainer = mock(() =>
    Promise.resolve(snapshot.ready ? { id: "roster-profile-container" } : null),
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
    setReady(ready: boolean) {
      snapshot = { ...snapshot, ready };
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
    expect(harness.symcrypt.requestSync).toHaveBeenCalledTimes(1);
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
    await waitFor(() =>
      expect(harness.symcrypt.open).toHaveBeenCalledTimes(33),
    );

    act(() =>
      view.result.current({ contributorUserIds, documentId: "document-a" }),
    );
    await act(async () => Promise.resolve());
    expect(harness.symcrypt.open).toHaveBeenCalledTimes(33);
  } finally {
    harness.restore();
  }
});

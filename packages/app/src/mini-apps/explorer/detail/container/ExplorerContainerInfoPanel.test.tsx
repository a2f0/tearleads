import { afterEach, expect, test } from "bun:test";
import type { ContainerInfo, ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import type { MiniAppWindowPosition } from "../../types";
import { ExplorerContainerInfoPanel } from "./ExplorerContainerInfoPanel";

const ICON_RESULT_NODE: ContainerNode = {
  id: "container-1",
  kind: "container",
  name: "Documents",
  organizationId: "org-1",
  parentId: "root-container",
  syncState: syncedContainerDocumentObjectSyncState,
};

afterEach(() => cleanup());

function createGroup(input: { groupId: string; name: string }) {
  return {
    createdAt: "2026-05-18T00:00:00.000Z",
    currentState: {
      keyEpoch: 1,
      keyFingerprint: `${input.groupId}-key-fingerprint`,
      memberCount: 1,
      stateHash: `${input.groupId}-state`,
      version: 1,
    },
    groupId: input.groupId,
    isBuiltin: input.name === "Admins",
    name: input.name,
    organizationId: "org-1",
  };
}

function createContainerInfo(
  overrides: Partial<ContainerInfo> = {},
): ContainerInfo {
  return {
    local: {
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-18T11:00:00.000Z",
    },
    remoteInfo: {
      grantRows: [
        {
          accessLevel: "read",
          inherited: false,
          sourceContainerId: "container-1",
          subjectId: "group-1",
          subjectType: "group",
        },
      ],
      grants: [
        {
          accessLevel: "read",
          subjectId: "group-1",
          subjectType: "group",
        },
      ],
      groups: [
        createGroup({ groupId: "group-1", name: "Admins" }),
        createGroup({ groupId: "group-2", name: "Writers" }),
      ],
      security: {
        currentContainerKeyEpoch: 1,
        currentContainerKeyEpochId: "container-key-epoch-1",
        currentManifestHash: "container-manifest-hash",
        currentManifestHistoryCount: 2,
        currentParentContainerKeyEpochId: null,
        currentReferencedPrincipalCount: 1,
        path: [
          {
            containerId: "container-1",
            containerKeyEpoch: 1,
            containerKeyEpochId: "container-key-epoch-1",
            directGrantCount: 1,
            eventHash: "event-hash-1",
            keyEpochHash: "key-epoch-hash-1",
            keyTargetHash: "key-target-hash-1",
            manifestHash: "container-manifest-hash",
            manifestHistoryCount: 2,
            parentContainerId: null,
            parentManifestHash: null,
            recipientTargetCount: 1,
            referencedPrincipalCount: 1,
            wrapCount: 1,
          },
        ],
        pathLength: 1,
      },
      syncCursors: [
        {
          label: "Container contents",
          laneId: "container-1",
          laneKind: "container-contents",
          savedAt: "2026-05-18T12:00:00.000Z",
          watermarkId: "watermark-1",
          watermarkUpdatedAt: "2026-05-18T12:01:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

type ContainerInfoPanelInput = {
  canManageIcon?: boolean;
  containerIcon?: string | null;
  containerSyncStatus?: string | null;
  loadContainerInfo?: (containerId: string) => Promise<ContainerInfo>;
  onOpenGrant?: ComponentProps<
    typeof ExplorerContainerInfoPanel
  >["onOpenGrant"];
  setContainerIcon?: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
  shareWithGroup?: ComponentProps<
    typeof ExplorerContainerInfoPanel
  >["shareWithGroup"];
};

function containerInfoPanelElement(input: ContainerInfoPanelInput = {}) {
  return createElement(ExplorerContainerInfoPanel, {
    canManageIcon: input.canManageIcon ?? false,
    containerIcon: input.containerIcon ?? null,
    containerId: "container-1",
    containerName: "Documents",
    containerNamesById: new Map([["container-1", "Documents"]]),
    containerSyncStatus: input.containerSyncStatus ?? "synced",
    canShareContainer: true,
    canShareWithPeer: true,
    loadContainerInfo:
      input.loadContainerInfo ?? (async () => createContainerInfo()),
    onOpenGrant: input.onOpenGrant ?? (() => undefined),
    peerUserId: "peer-user-1",
    setContainerIcon: input.setContainerIcon ?? (async () => null),
    shareWithGroup: input.shareWithGroup ?? (async () => true),
    shareWithUser: async () => true,
  });
}

function renderContainerInfoPanel(input: ContainerInfoPanelInput = {}) {
  return render(containerInfoPanelElement(input));
}

function getFolderIconPicker(view: ReturnType<typeof render>) {
  return view.getByRole("combobox", {
    name: "Folder icon",
  }) as HTMLButtonElement;
}

async function pickFolderIcon(view: ReturnType<typeof render>, label: string) {
  fireEvent.click(getFolderIconPicker(view));
  const option = (await view.findByText(label)).closest('[role="option"]');
  if (!(option instanceof HTMLElement)) {
    throw new Error(`Expected option for ${label}.`);
  }
  fireEvent.click(option);
}

test("container info tabs split general, sharing, security, and sync details", async () => {
  const view = renderContainerInfoPanel();

  await waitFor(() => {
    expect(view.getByText("Local Details")).toBeTruthy();
  });
  const localDetailsTable = view
    .getByRole("heading", { name: "Local Details" })
    .closest("section")
    ?.querySelector("table");
  expect(
    localDetailsTable?.classList.contains("mini-app-info-table--borderless"),
  ).toBe(true);
  expect(
    localDetailsTable?.classList.contains("mini-app-info-table--pinned"),
  ).toBe(true);
  expect(view.queryByText("Principal Grants")).toBeNull();

  fireEvent.click(view.getByRole("tab", { name: "Sharing" }));
  expect(view.getByText("Principal Grants")).toBeTruthy();
  expect(
    view
      .getByText("Principal Grants")
      .closest("section")
      ?.querySelector("table")
      ?.classList.contains("mini-app-info-table--row-divided"),
  ).toBe(true);
  expect(view.getByText("Share To Group")).toBeTruthy();
  expect(
    view
      .getByRole("combobox", { name: "Group" })
      .querySelector(".mini-app-select-menu-caret"),
  ).toBeTruthy();
  expect(view.getByText("Share To Peer")).toBeTruthy();
  expect(view.getByRole("button", { name: "Share" })).toBeTruthy();

  fireEvent.click(view.getByRole("tab", { name: "Security" }));
  expect(view.getByRole("heading", { name: "Security" })).toBeTruthy();
  expect(view.getByText("Container Path")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Share" })).toBeNull();

  fireEvent.click(view.getByRole("tab", { name: "Sync" }));
  expect(view.getByText("Sync Cursors")).toBeTruthy();
  expect(view.getByText("Container contents")).toBeTruthy();
});

// The label the user chose is bound to the signed group name by the SDK, so it
// is captured at selection time: a read-model relabel that lands between the
// choice and the submit must not change what gets bound.
test("a group share binds the label chosen, not a later relabel", async () => {
  const shareCalls: Array<{ groupId: string; expectedGroupName: string }> = [];
  const groupsByName = (name: string) => [
    createGroup({ groupId: "group-1", name: "Admins" }),
    createGroup({ groupId: "group-2", name }),
  ];
  const panelInput = (name: string, syncStatus: string) => ({
    containerSyncStatus: syncStatus,
    loadContainerInfo: async () => {
      const info = createContainerInfo();
      if (!info.remoteInfo) throw new Error("Expected remote info.");
      return {
        ...info,
        remoteInfo: { ...info.remoteInfo, groups: groupsByName(name) },
      };
    },
    shareWithGroup: async (
      _containerId: string,
      groupId: string,
      _accessLevel: "admin" | "read" | "write",
      options: { expectedGroupName: string },
    ) => {
      shareCalls.push({ groupId, ...options });
      return true;
    },
  });
  const view = render(containerInfoPanelElement(panelInput("Writers", "a")));

  await waitFor(() => {
    expect(view.getByText("Local Details")).toBeTruthy();
  });
  fireEvent.click(view.getByRole("tab", { name: "Sharing" }));
  fireEvent.click(view.getByRole("combobox", { name: "Group" }));
  // The menu's own label also reads "Writers"; pick the listed option.
  const option = (await view.findAllByText("Writers"))
    .map((element) => element.closest('[role="option"]'))
    .find((element): element is HTMLElement => element instanceof HTMLElement);
  if (!option) {
    throw new Error("Expected the Writers option.");
  }
  fireEvent.click(option);

  // The server relabels group-2 before the user submits.
  view.rerender(containerInfoPanelElement(panelInput("Auditors", "b")));
  await waitFor(() => {
    expect(view.queryByText("Auditors")).toBeTruthy();
  });

  fireEvent.click(view.getByRole("button", { name: "Share" }));
  await waitFor(() => {
    expect(shareCalls).toEqual([
      { expectedGroupName: "Writers", groupId: "group-2" },
    ]);
  });
});

test("container info sharing grant rows open grant detail targets", async () => {
  const openedGrants: Array<{
    grant: Parameters<
      ComponentProps<typeof ExplorerContainerInfoPanel>["onOpenGrant"]
    >[0];
    position: MiniAppWindowPosition | undefined;
  }> = [];
  const view = renderContainerInfoPanel({
    onOpenGrant: (grant, position) => {
      openedGrants.push({ grant, position });
    },
  });

  await waitFor(() => {
    expect(view.getByText("Local Details")).toBeTruthy();
  });
  fireEvent.click(view.getByRole("tab", { name: "Sharing" }));

  const grantRow = view.getByText("Admins").closest('[role="button"]');
  if (!(grantRow instanceof HTMLElement)) {
    throw new Error("Expected the grant row to be interactive.");
  }

  fireEvent.click(grantRow, { clientX: 40, clientY: 50 });

  expect(openedGrants).toEqual([
    {
      grant: {
        containerId: "container-1",
        subjectId: "group-1",
        subjectType: "group",
      },
      position: { x: 56, y: 66 },
    },
  ]);
});

test("admins can change the folder icon from the general tab", async () => {
  const calls: Array<{ containerId: string; icon: string | null }> = [];
  const view = renderContainerInfoPanel({
    canManageIcon: true,
    containerIcon: null,
    setContainerIcon: async (containerId, icon) => {
      calls.push({ containerId, icon });
      return ICON_RESULT_NODE;
    },
  });

  await waitFor(() => {
    expect(view.getByText("Local Details")).toBeTruthy();
  });

  const picker = getFolderIconPicker(view);
  expect(picker.textContent).toContain("Folder");
  expect(
    picker
      .closest(".mini-app-select-menu")
      ?.classList.contains("explorer-container-icon-picker"),
  ).toBe(true);
  expect(
    picker
      .querySelector(".mini-app-select-menu-icon")
      ?.getAttribute("data-icon"),
  ).toBe("folder");

  fireEvent.click(picker);
  const playlistOption = (await view.findByText("Music Playlist")).closest(
    '[role="option"]',
  );
  if (!(playlistOption instanceof HTMLElement)) {
    throw new Error("Expected Music Playlist option.");
  }
  expect(
    playlistOption
      .querySelector(".mini-app-select-menu-icon")
      ?.getAttribute("data-icon"),
  ).toBe("playlist");
  fireEvent.click(playlistOption);
  await waitFor(() => {
    expect(calls).toEqual([{ containerId: "container-1", icon: "playlist" }]);
  });

  // Selecting the default folder persists null (unset), not a "folder" slug.
  await pickFolderIcon(view, "Folder");
  await waitFor(() => {
    expect(calls).toEqual([
      { containerId: "container-1", icon: "playlist" },
      { containerId: "container-1", icon: null },
    ]);
  });
});

test("the icon picker follows the stored icon after the optimistic pick settles", async () => {
  const view = renderContainerInfoPanel({
    canManageIcon: true,
    containerIcon: null,
    setContainerIcon: async () => ICON_RESULT_NODE,
  });
  await waitFor(() => {
    expect(view.getByText("Local Details")).toBeTruthy();
  });
  const picker = () => getFolderIconPicker(view);

  // Optimistic local pick shows immediately, before the stored value updates.
  await pickFolderIcon(view, "Music Playlist");
  await waitFor(() => {
    expect(picker().textContent).toContain("Music Playlist");
  });

  // The write lands: the stored icon prop catches up, clearing the optimistic
  // state so a later change from another device is no longer masked by it.
  view.rerender(
    containerInfoPanelElement({
      canManageIcon: true,
      containerIcon: "playlist",
    }),
  );
  view.rerender(
    containerInfoPanelElement({ canManageIcon: true, containerIcon: "album" }),
  );
  await waitFor(() => {
    expect(picker().textContent).toContain("Photo Album");
  });
});

test("non-admins do not see the folder icon picker", async () => {
  const view = renderContainerInfoPanel({ canManageIcon: false });

  await waitFor(() => {
    expect(view.getByText("Local Details")).toBeTruthy();
  });
  expect(view.queryByLabelText("Folder icon")).toBeNull();
});

test("container info remote tabs show an unavailable state for local-only containers", async () => {
  const view = renderContainerInfoPanel({
    loadContainerInfo: async () => createContainerInfo({ remoteInfo: null }),
  });

  await waitFor(() => {
    expect(view.getByText("Local Details")).toBeTruthy();
  });
  fireEvent.click(view.getByRole("tab", { name: "Sharing" }));

  expect(view.getByText("Remote container info is unavailable.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Share" })).toBeNull();
});

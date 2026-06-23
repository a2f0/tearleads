import { afterEach, expect, test } from "bun:test";
import type { ContainerInfo } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { ExplorerContainerInfoPanel } from "./ExplorerContainerInfoPanel";

afterEach(() => cleanup());

function createGroup(input: { groupId: string; name: string }) {
  return {
    createdAt: "2026-05-18T00:00:00.000Z",
    currentState: {
      keyEpoch: 1,
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

function renderContainerInfoPanel(
  input: {
    loadContainerInfo?: (containerId: string) => Promise<ContainerInfo>;
  } = {},
) {
  return render(
    createElement(ExplorerContainerInfoPanel, {
      containerId: "container-1",
      containerName: "Documents",
      containerNamesById: new Map([["container-1", "Documents"]]),
      containerSyncStatus: "synced",
      loadContainerInfo:
        input.loadContainerInfo ?? (async () => createContainerInfo()),
      onBackToContainer: () => undefined,
      onOpenGrantGroup: () => undefined,
      peerUserId: "peer-user-1",
      shareWithGroup: async () => true,
      shareWithUser: async () => true,
    }),
  );
}

test("container info tabs split general, sharing, security, and sync details", async () => {
  const view = renderContainerInfoPanel();

  await waitFor(() => {
    expect(view.getByText("Local Details")).toBeTruthy();
  });
  expect(view.queryByText("Principal Grants")).toBeNull();

  fireEvent.click(view.getByRole("tab", { name: "Sharing" }));
  expect(view.getByText("Principal Grants")).toBeTruthy();
  expect(view.getByText("Share To Group")).toBeTruthy();
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

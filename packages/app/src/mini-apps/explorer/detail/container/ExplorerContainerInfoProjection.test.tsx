import { expect, test } from "bun:test";
import type {
  ContainerInfo,
  OrganizationDirectoryAndGroups,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import {
  getFoldedSecondaryTexts,
  mockPhoneRoutedLayout,
} from "../../../../../test/helpers/compactTableFold";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoEventLabel,
} from "../../labels";
import { compactId } from "../compactId";
import {
  ExplorerContainerInfoSecuritySection,
  ExplorerContainerInfoSyncCursorsSection,
} from "./ExplorerContainerInfoSecuritySyncSections";
import { useExplorerContainerInfo } from "./ExplorerContainerInfoState";

function group(groupId: string, name: string): OrganizationGroupSummary {
  return {
    createdAt: "2026-05-18T00:00:00.000Z",
    currentState: {
      keyEpoch: 1,
      keyFingerprint: `${groupId}-key-fingerprint`,
      memberCount: 1,
      stateHash: `${groupId}-state`,
      version: 1,
    },
    groupId,
    isBuiltin: name === "Admins",
    name,
    nameUnreadable: false,
    organizationId: "org-1",
  };
}

function containerInfo(): ContainerInfo {
  return {
    local: { createdAt: null, updatedAt: null },
    remoteInfo: {
      grantRows: [],
      grants: [],
      groups: [group("group-1", "Admins"), group("group-2", "Writers")],
      syncCursors: [],
    },
  };
}

function readModel(): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId: "org-1",
      profileDocumentId: null,
      users: [],
    },
    groups: [group("group-1", "Admins"), group("group-2", "Authors")],
    memberGroupId: "members-group",
    readModelCursor: "cursor-after",
  };
}

test("projection repaint replaces groups and authoritative purge without reloading", async () => {
  let loadCount = 0;
  const scope = {};
  const loadContainerInfo = async () => {
    loadCount += 1;
    return containerInfo();
  };
  const view = renderHook(
    (props: {
      projection: OrganizationDirectoryAndGroups | null;
      revision: number;
      scope: object | null;
    }) =>
      useExplorerContainerInfo({
        containerId: "container-1",
        loadContainerInfo,
        organizationReadModelProjection: props.projection,
        organizationReadModelRevision: props.revision,
        organizationReadModelScope: props.scope,
      }),
    {
      initialProps: {
        projection: null as OrganizationDirectoryAndGroups | null,
        revision: 0,
        scope,
      },
    },
  );
  await waitFor(() => {
    expect(
      view.result.current.containerInfo?.remoteInfo?.groups.map(
        (entry) => entry.name,
      ),
    ).toEqual(["Admins", "Writers"]);
  });
  act(() => view.result.current.setDraftShareGroupId("group-2"));
  view.rerender({ projection: readModel(), revision: 1, scope });
  await waitFor(() => {
    expect(
      view.result.current.containerInfo?.remoteInfo?.groups.map(
        (entry) => entry.name,
      ),
    ).toEqual(["Admins", "Authors"]);
  });
  expect(view.result.current.draftShareGroupId).toBe("group-2");
  expect(loadCount).toBe(1);

  view.rerender({ projection: null, revision: 2, scope });
  await waitFor(() => {
    expect(view.result.current.containerInfo?.remoteInfo?.groups).toEqual([]);
    expect(view.result.current.draftShareGroupId).toBe("");
  });
  expect(loadCount).toBe(1);
});

test("revision-zero exact-scope transition hides stale container presentation and resets drafts", async () => {
  const firstScope = {};
  const secondScope = {};
  let resolveSecondLoad: (info: ContainerInfo) => void = () => undefined;
  const secondLoad = new Promise<ContainerInfo>((resolve) => {
    resolveSecondLoad = resolve;
  });
  let loadCount = 0;
  const loadContainerInfo = () => {
    loadCount += 1;
    return loadCount === 1 ? Promise.resolve(containerInfo()) : secondLoad;
  };
  const view = renderHook(
    (props: {
      projection: OrganizationDirectoryAndGroups | null;
      revision: number;
      scope: object | null;
    }) =>
      useExplorerContainerInfo({
        containerId: "container-1",
        loadContainerInfo,
        organizationReadModelProjection: props.projection,
        organizationReadModelRevision: props.revision,
        organizationReadModelScope: props.scope,
      }),
    {
      initialProps: {
        projection: readModel() as OrganizationDirectoryAndGroups | null,
        revision: 1,
        scope: firstScope as object | null,
      },
    },
  );
  await waitFor(() => {
    expect(view.result.current.containerInfo?.remoteInfo).not.toBeNull();
  });
  act(() => view.result.current.setDraftShareGroupId("group-2"));

  view.rerender({ projection: null, revision: 0, scope: secondScope });
  expect(view.result.current.containerInfo).toBeNull();
  expect(view.result.current.draftShareGroupId).toBe("");

  await waitFor(() => expect(loadCount).toBe(2));
  const secondInfo = containerInfo();
  if (!secondInfo.remoteInfo) {
    throw new Error("expected remote container info");
  }
  resolveSecondLoad({
    ...secondInfo,
    remoteInfo: {
      ...secondInfo.remoteInfo,
      groups: [group("group-3", "Readers")],
    },
  });
  await waitFor(() => {
    expect(
      view.result.current.containerInfo?.remoteInfo?.groups.map(
        (entry) => entry.name,
      ),
    ).toEqual(["Readers"]);
  });

  view.rerender({ projection: null, revision: 0, scope: null });
  expect(view.result.current.containerInfo).toBeNull();
  expect(view.result.current.draftShareGroupId).toBe("");
  await act(async () => Promise.resolve());
  expect(loadCount).toBe(2);
});

test("an offline loader change keeps cached container presentation", async () => {
  const scope = {};
  let loadCount = 0;
  const view = renderHook(
    (props: { loadContainerInfo: () => Promise<ContainerInfo> }) =>
      useExplorerContainerInfo({
        containerId: "container-1",
        loadContainerInfo: props.loadContainerInfo,
        organizationReadModelProjection: null,
        organizationReadModelRevision: 0,
        organizationReadModelScope: scope,
      }),
    {
      initialProps: {
        loadContainerInfo: async () => {
          loadCount += 1;
          return containerInfo();
        },
      },
    },
  );
  await waitFor(() => {
    expect(view.result.current.containerInfo?.remoteInfo).not.toBeNull();
  });

  view.rerender({
    loadContainerInfo: async () => {
      loadCount += 1;
      return { ...containerInfo(), remoteInfo: null };
    },
  });
  await act(async () => Promise.resolve());
  expect(loadCount).toBe(1);
  expect(view.result.current.containerInfo?.remoteInfo).not.toBeNull();
});

function securitySyncRemoteInfo(): NonNullable<ContainerInfo["remoteInfo"]> {
  return {
    grantRows: [],
    grants: [],
    groups: [],
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
          containerKeyEpoch: 3,
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
        savedAt: null,
        watermarkId: null,
        watermarkUpdatedAt: null,
      },
    ],
  };
}

// On a phone the security path and sync cursor tables fold every column after
// the first into a muted second line; every value must still be on screen.
test("folded security path rows keep manifest, key epoch, and counts", () => {
  const restoreLayout = mockPhoneRoutedLayout();
  try {
    const view = render(
      createElement(ExplorerContainerInfoSecuritySection, {
        containerNamesById: new Map([["container-1", "Documents"]]),
        remoteInfo: securitySyncRemoteInfo(),
      }),
    );
    const table = view.getByRole("table", {
      name: EXPLORER_LABELS.containerInfoPathHeading,
    });

    expect(table.querySelectorAll("thead th")).toHaveLength(1);
    expect(within(table).getByText("Documents")).toBeTruthy();
    const [fields] = getFoldedSecondaryTexts(table);
    expect(fields?.[0]).toBe(
      `${EXPLORER_LABELS.containerInfoManifestColumn}: ${compactId("container-manifest-hash")} · ${getExplorerContainerInfoEventLabel(compactId("event-hash-1"))}`,
    );
    expect(fields?.[1]).toBe(
      `${EXPLORER_LABELS.containerInfoSecurityKeyEpochRow}: 3 / ${compactId("container-key-epoch-1")}`,
    );
    expect(fields?.[2]).toStartWith(
      `${EXPLORER_LABELS.containerInfoRecipientsColumn}: `,
    );
  } finally {
    cleanup();
    restoreLayout();
  }
});

test("folded sync cursor rows keep the cursor and saved times", () => {
  const restoreLayout = mockPhoneRoutedLayout();
  try {
    const view = render(
      createElement(ExplorerContainerInfoSyncCursorsSection, {
        remoteInfo: securitySyncRemoteInfo(),
      }),
    );
    const table = view.getByRole("table", {
      name: EXPLORER_LABELS.containerInfoSyncCursorsHeading,
    });

    expect(table.querySelectorAll("thead th")).toHaveLength(1);
    expect(within(table).getByText("Container contents")).toBeTruthy();
    expect(getFoldedSecondaryTexts(table)).toEqual([
      [
        `${EXPLORER_LABELS.containerInfoCursorColumn}: ${EXPLORER_LABELS.containerInfoNoLocalCursor}`,
        `${EXPLORER_LABELS.containerInfoSavedColumn}: -`,
      ],
    ]);
  } finally {
    cleanup();
    restoreLayout();
  }
});

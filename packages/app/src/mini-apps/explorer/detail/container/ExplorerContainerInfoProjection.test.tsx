import { expect, test } from "bun:test";
import type {
  ContainerInfo,
  OrganizationDirectoryAndGroups,
  OrganizationGroupSummary,
} from "@symcrypt/client-sdk";
import { act, renderHook, waitFor } from "@testing-library/react";
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

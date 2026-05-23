import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import type { ExplorerContainerInfo } from "../../../stores/explorer/containerInfo";
import {
  type ExplorerContainerInfoGrant,
  type ReloadExplorerContainerInfo,
  upsertContainerInfoGrant,
  useExplorerContainerInfo,
  useExplorerContainerInfoGroupShare,
} from "./ExplorerContainerInfoState";

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, reject, resolve };
}

function createGroup(input: {
  current: boolean;
  groupId: string;
  name: string;
}) {
  return {
    createdAt: "2026-05-18T00:00:00.000Z",
    currentState: input.current
      ? {
          keyEpoch: 1,
          memberCount: 1,
          stateHash: `${input.groupId}-state`,
          version: 1,
        }
      : null,
    groupId: input.groupId,
    name: input.name,
    organizationId: "org-1",
  };
}

function createContainerInfo(
  overrides: Partial<ExplorerContainerInfo> = {},
): ExplorerContainerInfo {
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
        createGroup({ current: false, groupId: "stale-group", name: "Stale" }),
        createGroup({ current: true, groupId: "group-1", name: "Admins" }),
      ],
      syncCursors: [],
    },
    ...overrides,
  };
}

function createSubmitEvent(): FormEvent<HTMLFormElement> {
  return {
    preventDefault: () => undefined,
  } as FormEvent<HTMLFormElement>;
}

afterEach(() => {
  cleanup();
});

test("upsertContainerInfoGrant appends and updates remote grants", () => {
  const info = createContainerInfo();
  const updatedGrant: ExplorerContainerInfoGrant = {
    accessLevel: "admin",
    subjectId: "group-1",
    subjectType: "group",
  };
  const appendedGrant: ExplorerContainerInfoGrant = {
    accessLevel: "write",
    subjectId: "user-1",
    subjectType: "user",
  };

  const updatedInfo = upsertContainerInfoGrant(
    info,
    updatedGrant,
    "container-1",
  );
  expect(updatedInfo.remoteInfo?.grants).toEqual([updatedGrant]);
  expect(updatedInfo.remoteInfo?.grantRows).toEqual([
    {
      ...updatedGrant,
      inherited: false,
      sourceContainerId: "container-1",
    },
  ]);

  const appendedInfo = upsertContainerInfoGrant(
    updatedInfo,
    appendedGrant,
    "container-1",
  );
  expect(appendedInfo.remoteInfo?.grants).toEqual([
    updatedGrant,
    appendedGrant,
  ]);
  expect(appendedInfo.remoteInfo?.grantRows).toEqual([
    {
      ...updatedGrant,
      inherited: false,
      sourceContainerId: "container-1",
    },
    {
      ...appendedGrant,
      inherited: false,
      sourceContainerId: "container-1",
    },
  ]);

  const localOnlyInfo = createContainerInfo({ remoteInfo: null });
  expect(
    upsertContainerInfoGrant(localOnlyInfo, appendedGrant, "container-1"),
  ).toBe(localOnlyInfo);
});

test("useExplorerContainerInfo loads info and selects the first shareable group", async () => {
  const loadContainerInfo = async () => createContainerInfo();
  const view = renderHook(() =>
    useExplorerContainerInfo({
      containerId: "container-1",
      loadContainerInfo,
    }),
  );

  await waitFor(() => {
    expect(
      view.result.current.containerInfo?.remoteInfo?.groups[1]?.groupId,
    ).toBe("group-1");
    expect(view.result.current.draftShareAccessLevel).toBe("write");
    expect(view.result.current.draftShareGroupId).toBe("group-1");
    expect(view.result.current.isLoadingContainerInfo).toBe(false);
  });
});

test("useExplorerContainerInfo ignores stale requests after the container changes", async () => {
  const firstLoad = createDeferred<ExplorerContainerInfo>();
  const secondLoad = createDeferred<ExplorerContainerInfo>();
  const requestedContainerIds: string[] = [];
  const loadContainerInfo = (requestedContainerId: string) => {
    requestedContainerIds.push(requestedContainerId);
    return requestedContainerId === "container-1"
      ? firstLoad.promise
      : secondLoad.promise;
  };
  const view = renderHook(
    ({ containerId }: { containerId: string }) =>
      useExplorerContainerInfo({
        containerId,
        loadContainerInfo,
      }),
    { initialProps: { containerId: "container-1" } },
  );

  await waitFor(() => {
    expect(requestedContainerIds).toEqual(["container-1"]);
  });

  view.rerender({ containerId: "container-2" });

  await waitFor(() => {
    expect(requestedContainerIds).toEqual(["container-1", "container-2"]);
  });

  await act(async () => {
    secondLoad.resolve(
      createContainerInfo({
        local: {
          createdAt: "2026-05-18T12:00:00.000Z",
          updatedAt: "2026-05-18T12:30:00.000Z",
        },
      }),
    );
    await secondLoad.promise;
  });

  await waitFor(() => {
    expect(view.result.current.containerInfo?.local.createdAt).toBe(
      "2026-05-18T12:00:00.000Z",
    );
    expect(view.result.current.isLoadingContainerInfo).toBe(false);
  });

  await act(async () => {
    firstLoad.resolve(
      createContainerInfo({
        local: {
          createdAt: "2026-05-18T09:00:00.000Z",
          updatedAt: "2026-05-18T09:30:00.000Z",
        },
      }),
    );
    await firstLoad.promise;
  });

  expect(view.result.current.containerInfo?.local.createdAt).toBe(
    "2026-05-18T12:00:00.000Z",
  );
});

test("useExplorerContainerInfo surfaces loader errors", async () => {
  const loadContainerInfo = async () => {
    throw new Error("failed to load container info");
  };
  const view = renderHook(() =>
    useExplorerContainerInfo({
      containerId: "container-1",
      loadContainerInfo,
    }),
  );

  await waitFor(() => {
    expect(view.result.current.containerInfo).toBeNull();
    expect(view.result.current.containerInfoError).toBe(
      "failed to load container info",
    );
    expect(view.result.current.isLoadingContainerInfo).toBe(false);
  });
});

test("useExplorerContainerInfoGroupShare requires a draft group", async () => {
  const panelErrors: Array<string | null> = [];
  const shareCalls: string[] = [];
  const view = renderHook(() =>
    useExplorerContainerInfoGroupShare({
      containerId: "container-1",
      draftShareAccessLevel: "write",
      draftShareGroupId: "",
      isSubmitting: false,
      reloadContainerInfo: async () => undefined,
      setIsSubmitting: () => undefined,
      setPanelError: (error) => {
        panelErrors.push(error);
      },
      shareWithGroup: async (_containerId, groupId) => {
        shareCalls.push(groupId);
        return true;
      },
    }),
  );

  await act(async () => {
    await view.result.current(createSubmitEvent());
  });

  expect(panelErrors).toEqual(["Choose a group."]);
  expect(shareCalls).toEqual([]);
});

test("useExplorerContainerInfoGroupShare reloads with an optimistic grant", async () => {
  let reloadOptions: Parameters<ReloadExplorerContainerInfo>[0];
  const submittingStates: boolean[] = [];
  const panelErrors: Array<string | null> = [];
  const shareCalls: Array<{
    accessLevel: string;
    containerId: string;
    groupId: string;
  }> = [];
  const view = renderHook(() =>
    useExplorerContainerInfoGroupShare({
      containerId: "container-1",
      draftShareAccessLevel: "admin",
      draftShareGroupId: "group-1",
      isSubmitting: false,
      reloadContainerInfo: async (options) => {
        reloadOptions = options;
      },
      setIsSubmitting: (value) => {
        submittingStates.push(value);
      },
      setPanelError: (error) => {
        panelErrors.push(error);
      },
      shareWithGroup: async (containerId, groupId, accessLevel) => {
        shareCalls.push({ accessLevel, containerId, groupId });
        return true;
      },
    }),
  );

  await act(async () => {
    await view.result.current(createSubmitEvent());
  });

  expect(shareCalls).toEqual([
    {
      accessLevel: "admin",
      containerId: "container-1",
      groupId: "group-1",
    },
  ]);
  expect(reloadOptions).toEqual({
    optimisticGrant: {
      accessLevel: "admin",
      subjectId: "group-1",
      subjectType: "group",
    },
  });
  expect(panelErrors).toEqual([null]);
  expect(submittingStates).toEqual([true, false]);
});

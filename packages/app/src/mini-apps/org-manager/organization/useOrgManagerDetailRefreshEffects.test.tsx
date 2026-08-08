import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { GroupDetailsEffectKey } from "../refresh";
import type { OrgManagerView } from "../routes";
import { useOrgManagerDetailRefreshEffects } from "./useOrgManagerDetailRefreshEffects";

afterEach(() => cleanup());

interface DetailRefreshProbeProps {
  readonly readModelCursor: string | null;
  readonly refreshSelectedGroupContainers: (
    groupId: string | null,
  ) => Promise<void>;
  readonly refreshSelectedGroupDetails: (
    groupId: string | null,
  ) => Promise<void>;
  readonly refreshSelectedUserDetail: (userId: string | null) => Promise<void>;
  readonly selectedGroupAvailable: boolean;
  readonly selectedGroupId: string | null;
  readonly selectedGroupStateHash: string | null;
  readonly selectedUserId: string | null;
  readonly skippedGroupDetailsEffectRef: {
    current: GroupDetailsEffectKey | null;
  };
  readonly view: OrgManagerView;
}

function DetailRefreshProbe(props: DetailRefreshProbeProps) {
  useOrgManagerDetailRefreshEffects(props);
  return null;
}

test("retained selections load details only in their visible view", () => {
  const groupLoads: Array<string | null> = [];
  const userLoads: Array<string | null> = [];
  const skippedGroupDetailsEffectRef = { current: null };
  const stableProps = {
    readModelCursor: "cursor-1",
    refreshSelectedGroupContainers: async () => {},
    refreshSelectedGroupDetails: async (groupId: string | null) => {
      groupLoads.push(groupId);
    },
    refreshSelectedUserDetail: async (userId: string | null) => {
      userLoads.push(userId);
    },
    skippedGroupDetailsEffectRef,
    selectedGroupAvailable: true,
    selectedGroupStateHash: "state-a",
  };
  const view = render(
    <DetailRefreshProbe
      {...stableProps}
      selectedGroupId="group-a"
      selectedUserId="user-a"
      view="grants"
    />,
  );

  act(() => {
    view.rerender(
      <DetailRefreshProbe
        {...stableProps}
        selectedGroupId="group-b"
        selectedUserId="user-b"
        view="usage"
      />,
    );
  });
  expect(groupLoads).toEqual([]);
  expect(userLoads).toEqual([]);

  act(() => {
    view.rerender(
      <DetailRefreshProbe
        {...stableProps}
        selectedGroupId="group-b"
        selectedUserId="user-b"
        view="groups"
      />,
    );
  });
  expect(groupLoads).toEqual(["group-b"]);
  expect(userLoads).toEqual([]);

  act(() => {
    view.rerender(
      <DetailRefreshProbe
        {...stableProps}
        selectedGroupId="group-c"
        selectedUserId="user-c"
        view="directory"
      />,
    );
  });
  expect(groupLoads).toEqual(["group-b"]);
  expect(userLoads).toEqual(["user-c"]);
});

test("a manual group refresh skip is consumed only when groups are visible", () => {
  const groupLoads: Array<string | null> = [];
  const skippedGroupDetailsEffectRef: {
    current: GroupDetailsEffectKey | null;
  } = { current: { groupId: "group-a", stateHash: "state-a" } };
  const stableProps = {
    readModelCursor: "cursor-1",
    refreshSelectedGroupContainers: async () => {},
    refreshSelectedGroupDetails: async (groupId: string | null) => {
      groupLoads.push(groupId);
    },
    refreshSelectedUserDetail: async (_userId: string | null) => undefined,
    selectedGroupId: "group-a",
    selectedGroupStateHash: "state-a",
    selectedUserId: "user-a",
    selectedGroupAvailable: true,
    skippedGroupDetailsEffectRef,
  };
  const view = render(
    <DetailRefreshProbe {...stableProps} view="organization" />,
  );

  expect(groupLoads).toEqual([]);
  expect(skippedGroupDetailsEffectRef.current).toEqual({
    groupId: "group-a",
    stateHash: "state-a",
  });

  act(() => {
    view.rerender(<DetailRefreshProbe {...stableProps} view="groups" />);
  });
  expect(groupLoads).toEqual([]);
  expect(skippedGroupDetailsEffectRef.current).toBeNull();

  act(() => {
    view.rerender(
      <DetailRefreshProbe
        {...stableProps}
        selectedGroupStateHash="state-b"
        view="groups"
      />,
    );
  });
  expect(groupLoads).toEqual(["group-a"]);
});

test("a cold group deep link loads once its group arrives in the snapshot", () => {
  const groupLoads: Array<string | null> = [];
  const skippedGroupDetailsEffectRef = { current: null };
  const refreshSelectedGroupDetails = async (nextGroupId: string | null) => {
    groupLoads.push(nextGroupId);
  };
  const stableProps = {
    readModelCursor: "cursor-1",
    refreshSelectedGroupContainers: async () => {},
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail: async () => {},
    selectedGroupId: "group-a",
    selectedGroupStateHash: "state-a",
    selectedUserId: null,
    skippedGroupDetailsEffectRef,
    view: "groups" as const,
  };
  const view = render(
    <DetailRefreshProbe {...stableProps} selectedGroupAvailable={false} />,
  );

  expect(groupLoads).toEqual([]);

  act(() => {
    view.rerender(
      <DetailRefreshProbe {...stableProps} selectedGroupAvailable />,
    );
  });
  expect(groupLoads).toEqual(["group-a"]);
});

test("a reconciled membership state reloads a retained group", () => {
  const groupLoads: Array<string | null> = [];
  const stableProps = {
    readModelCursor: "cursor-1",
    refreshSelectedGroupContainers: async () => {},
    refreshSelectedGroupDetails: async (groupId: string | null) => {
      groupLoads.push(groupId);
    },
    refreshSelectedUserDetail: async () => {},
    selectedGroupAvailable: true,
    selectedGroupId: "group-a",
    selectedUserId: null,
    skippedGroupDetailsEffectRef: { current: null },
    view: "groups" as const,
  };
  const view = render(
    <DetailRefreshProbe {...stableProps} selectedGroupStateHash="state-1" />,
  );

  expect(groupLoads).toEqual(["group-a"]);

  act(() => {
    view.rerender(
      <DetailRefreshProbe {...stableProps} selectedGroupStateHash="state-2" />,
    );
  });
  expect(groupLoads).toEqual(["group-a", "group-a"]);

  act(() => {
    view.rerender(
      <DetailRefreshProbe {...stableProps} selectedGroupStateHash="state-2" />,
    );
  });
  expect(groupLoads).toEqual(["group-a", "group-a"]);
});

test("a skip for an older state does not hide reconciled members", () => {
  const groupLoads: Array<string | null> = [];
  const skippedGroupDetailsEffectRef = {
    current: { groupId: "group-a", stateHash: "state-1" },
  };

  render(
    <DetailRefreshProbe
      readModelCursor="cursor-1"
      refreshSelectedGroupContainers={async () => {}}
      refreshSelectedGroupDetails={async (groupId) => {
        groupLoads.push(groupId);
      }}
      refreshSelectedUserDetail={async () => {}}
      selectedGroupAvailable
      selectedGroupId="group-a"
      selectedGroupStateHash="state-2"
      selectedUserId={null}
      skippedGroupDetailsEffectRef={skippedGroupDetailsEffectRef}
      view="groups"
    />,
  );

  expect(groupLoads).toEqual(["group-a"]);
  expect(skippedGroupDetailsEffectRef.current).toBeNull();
});

test("cursor advancement repaints local details without reloading group policy", () => {
  const groupLoads: Array<string | null> = [];
  const containerLoads: Array<string | null> = [];
  const userLoads: Array<string | null> = [];
  const stableProps = {
    refreshSelectedGroupContainers: async (groupId: string | null) => {
      containerLoads.push(groupId);
    },
    refreshSelectedGroupDetails: async (groupId: string | null) => {
      groupLoads.push(groupId);
    },
    refreshSelectedUserDetail: async (userId: string | null) => {
      userLoads.push(userId);
    },
    selectedGroupAvailable: true,
    selectedGroupId: "group-a",
    selectedGroupStateHash: "state-1",
    selectedUserId: "user-a",
    skippedGroupDetailsEffectRef: { current: null },
  };
  const view = render(
    <DetailRefreshProbe
      {...stableProps}
      readModelCursor="cursor-1"
      view="groups"
    />,
  );

  expect(groupLoads).toEqual(["group-a"]);
  expect(containerLoads).toEqual(["group-a"]);

  act(() => {
    view.rerender(
      <DetailRefreshProbe
        {...stableProps}
        readModelCursor="cursor-2"
        view="groups"
      />,
    );
  });
  expect(groupLoads).toEqual(["group-a"]);
  expect(containerLoads).toEqual(["group-a", "group-a"]);

  act(() => {
    view.rerender(
      <DetailRefreshProbe
        {...stableProps}
        readModelCursor="cursor-2"
        view="directory"
      />,
    );
  });
  expect(userLoads).toEqual(["user-a"]);

  act(() => {
    view.rerender(
      <DetailRefreshProbe
        {...stableProps}
        readModelCursor="cursor-3"
        view="directory"
      />,
    );
  });
  expect(userLoads).toEqual(["user-a", "user-a"]);
});

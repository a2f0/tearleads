import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { OrgManagerView } from "../routes";
import { useOrgManagerDetailRefreshes } from "./useOrgManagerDetailRefreshes";

afterEach(() => cleanup());

interface DetailRefreshProbeProps {
  readonly refreshSelectedGroupDetails: (
    groupId: string | null,
  ) => Promise<void>;
  readonly refreshSelectedUserDetail: (userId: string | null) => Promise<void>;
  readonly selectedGroupAvailable: boolean;
  readonly selectedGroupId: string | null;
  readonly selectedUserId: string | null;
  readonly skippedGroupDetailsEffectRef: {
    current: { groupId: string | null } | null;
  };
  readonly view: OrgManagerView;
}

function DetailRefreshProbe(props: DetailRefreshProbeProps) {
  useOrgManagerDetailRefreshes(props);
  return null;
}

test("retained selections load details only in their visible view", () => {
  const groupLoads: Array<string | null> = [];
  const userLoads: Array<string | null> = [];
  const skippedGroupDetailsEffectRef = { current: null };
  const stableProps = {
    refreshSelectedGroupDetails: async (groupId: string | null) => {
      groupLoads.push(groupId);
    },
    refreshSelectedUserDetail: async (userId: string | null) => {
      userLoads.push(userId);
    },
    skippedGroupDetailsEffectRef,
    selectedGroupAvailable: true,
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
    current: { groupId: string | null } | null;
  } = { current: { groupId: "group-a" } };
  const stableProps = {
    refreshSelectedGroupDetails: async (groupId: string | null) => {
      groupLoads.push(groupId);
    },
    refreshSelectedUserDetail: async (_userId: string | null) => undefined,
    selectedGroupId: "group-a",
    selectedUserId: "user-a",
    selectedGroupAvailable: true,
    skippedGroupDetailsEffectRef,
  };
  const view = render(
    <DetailRefreshProbe {...stableProps} view="organization" />,
  );

  expect(groupLoads).toEqual([]);
  expect(skippedGroupDetailsEffectRef.current).toEqual({ groupId: "group-a" });

  act(() => {
    view.rerender(<DetailRefreshProbe {...stableProps} view="groups" />);
  });
  expect(groupLoads).toEqual([]);
  expect(skippedGroupDetailsEffectRef.current).toBeNull();
});

test("a cold group deep link loads once its group arrives in the snapshot", () => {
  const groupLoads: Array<string | null> = [];
  const skippedGroupDetailsEffectRef = { current: null };
  const refreshSelectedGroupDetails = async (nextGroupId: string | null) => {
    groupLoads.push(nextGroupId);
  };
  const stableProps = {
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail: async () => {},
    selectedGroupId: "group-a",
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

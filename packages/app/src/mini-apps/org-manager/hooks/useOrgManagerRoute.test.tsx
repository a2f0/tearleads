import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useOrgManagerRoute } from "./useOrgManagerRoute";

const groups = [{ groupId: "admins" }, { groupId: "members" }] as const;

test("org manager route view changes preserve selected group", () => {
  const view = renderHook(() => useOrgManagerRoute({ groups }));

  expect(view.result.current.route).toEqual({
    selectedGrantRef: null,
    selectedGroupId: null,
    view: "directory",
  });

  act(() => {
    view.result.current.setSelectedGroupId("members");
  });
  act(() => {
    view.result.current.setView("grants");
  });

  expect(view.result.current.route).toEqual({
    selectedGrantRef: null,
    selectedGroupId: "members",
    view: "grants",
  });
  expect(view.result.current.selectedGroupIdRef.current).toBe("members");
});

test("org manager group route activates groups view", () => {
  const view = renderHook(() => useOrgManagerRoute({ groups }));

  act(() => {
    view.result.current.openGroupRoute("admins");
  });

  expect(view.result.current.route).toEqual({
    selectedGrantRef: null,
    selectedGroupId: "admins",
    view: "groups",
  });
});

test("org manager grant route activates grants view", () => {
  const view = renderHook(() => useOrgManagerRoute({ groups }));

  act(() => {
    view.result.current.openGrantRoute({
      containerId: "container-1",
      subjectId: "admins",
      subjectType: "group",
    });
  });

  expect(view.result.current.route).toEqual({
    selectedGrantRef: {
      containerId: "container-1",
      subjectId: "admins",
      subjectType: "group",
    },
    selectedGroupId: null,
    view: "grants",
  });
});

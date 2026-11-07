import { afterEach, expect, test } from "bun:test";
import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useGroupDeletionConfirmation } from "./useGroupDeletionConfirmation";

afterEach(cleanup);

const group: OrganizationGroupSummary = {
  createdAt: "2026-05-20T12:00:00.000Z",
  currentState: null,
  groupId: "group-1",
  isBuiltin: false,
  name: "Operators",
  nameUnreadable: false,
  organizationId: "organization-1",
};

function renderConfirmation() {
  const deleted: string[] = [];
  const view = renderHook(useGroupDeletionConfirmation, {
    initialProps: {
      canDeleteGroup: (candidate: OrganizationGroupSummary) =>
        !candidate.isBuiltin,
      deleteGroup: (id: string) => {
        deleted.push(id);
      },
      groups: [group],
      mutating: false,
    },
  });
  return { ...view, deleted };
}

test("clears confirmation when its group leaves the current organization view", () => {
  const view = renderConfirmation();
  act(() => view.result.current.request(group.groupId));
  expect(view.result.current.group).toEqual(group);
  const props = {
    canDeleteGroup: () => true,
    deleteGroup: (id: string) => {
      view.deleted.push(id);
    },
    groups: [] as OrganizationGroupSummary[],
    mutating: false,
  };
  view.rerender(props);
  expect(view.result.current.group).toBeNull();
  view.rerender({ ...props, groups: [group] });
  expect(view.result.current.group).toBeNull();
  act(() => view.result.current.confirm());
  expect(view.deleted).toEqual([]);
});

for (const blockedBy of ["mutation", "permissions"] as const) {
  test(`rechecks ${blockedBy} before confirming or requesting deletion`, () => {
    const view = renderConfirmation();
    act(() => view.result.current.request(group.groupId));
    view.rerender({
      canDeleteGroup: () => blockedBy !== "permissions",
      deleteGroup: (id) => {
        view.deleted.push(id);
      },
      groups: [group],
      mutating: blockedBy === "mutation",
    });
    expect(view.result.current.disabled).toBe(true);
    act(() => view.result.current.confirm());
    expect(view.deleted).toEqual([]);
    act(() => view.result.current.cancel());
    act(() => view.result.current.request(group.groupId));
    expect(view.result.current.group).toBeNull();
  });
}

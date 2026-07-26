import { expect, test } from "bun:test";
import { resolveOrgManagerDetailBackVisibility } from "./detailBackActions";

const NONE = {
  hasSelectedGrant: false,
  hasSelectedGroup: false,
  hasSelectedUser: false,
} as const;

test("roster detail back surfaces with or without history (roster selection is not routed)", () => {
  const noHistory = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedUser: true,
    historyCanGoBack: false,
    view: "directory",
  });
  const withHistory = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedUser: true,
    historyCanGoBack: true,
    view: "directory",
  });

  expect(noHistory.showRosterDetailBackAction).toBe(true);
  expect(withHistory.showRosterDetailBackAction).toBe(true);
});

test("group detail back surfaces only with no history to pop", () => {
  const noHistory = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedGroup: true,
    historyCanGoBack: false,
    view: "groups",
  });
  const withHistory = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedGroup: true,
    historyCanGoBack: true,
    view: "groups",
  });

  expect(noHistory.showGroupDetailBackAction).toBe(true);
  // Registering where the host can go back would turn its history pop into a
  // route push, and Back would alternate between the group and its list.
  expect(withHistory.showGroupDetailBackAction).toBe(false);
});

test("grant detail back surfaces only with no history to pop", () => {
  const noHistory = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedGrant: true,
    historyCanGoBack: false,
    view: "grants",
  });
  const withHistory = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedGrant: true,
    historyCanGoBack: true,
    view: "grants",
  });

  expect(noHistory.showGrantDetailBackAction).toBe(true);
  expect(withHistory.showGrantDetailBackAction).toBe(false);
});

test("no back action without a selection", () => {
  const result = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    historyCanGoBack: false,
    view: "groups",
  });

  expect(result).toEqual({
    showGrantDetailBackAction: false,
    showGroupDetailBackAction: false,
    showRosterDetailBackAction: false,
  });
});

test("the three back actions are mutually exclusive per view", () => {
  const groups = resolveOrgManagerDetailBackVisibility({
    hasSelectedGrant: true,
    hasSelectedGroup: true,
    hasSelectedUser: true,
    historyCanGoBack: false,
    view: "groups",
  });

  // Even with every selection set, only the active view's action shows.
  expect(groups).toEqual({
    showGrantDetailBackAction: false,
    showGroupDetailBackAction: true,
    showRosterDetailBackAction: false,
  });
});

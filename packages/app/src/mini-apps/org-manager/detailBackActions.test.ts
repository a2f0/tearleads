import { expect, test } from "bun:test";
import { resolveOrgManagerDetailBackVisibility } from "./detailBackActions";

const NONE = {
  hasSelectedGrant: false,
  hasSelectedGroup: false,
  hasSelectedUser: false,
} as const;

test("roster detail back surfaces in every mode (roster selection is not routed)", () => {
  const windowed = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedUser: true,
    mode: "windowed",
    view: "directory",
  });
  const routed = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedUser: true,
    mode: "routed",
    view: "directory",
  });

  expect(windowed.showRosterDetailBackAction).toBe(true);
  expect(routed.showRosterDetailBackAction).toBe(true);
});

test("group detail back surfaces only in windowed mode (routed keeps history caret)", () => {
  const windowed = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedGroup: true,
    mode: "windowed",
    view: "groups",
  });
  const routed = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedGroup: true,
    mode: "routed",
    view: "groups",
  });

  expect(windowed.showGroupDetailBackAction).toBe(true);
  // Registering in a routed tier would turn the app bar's history pop into a
  // route push and break mobile/tablet back/forward.
  expect(routed.showGroupDetailBackAction).toBe(false);
});

test("grant detail back surfaces only in windowed mode", () => {
  const windowed = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedGrant: true,
    mode: "windowed",
    view: "grants",
  });
  const routed = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    hasSelectedGrant: true,
    mode: "routed",
    view: "grants",
  });

  expect(windowed.showGrantDetailBackAction).toBe(true);
  expect(routed.showGrantDetailBackAction).toBe(false);
});

test("no back action without a selection", () => {
  const result = resolveOrgManagerDetailBackVisibility({
    ...NONE,
    mode: "windowed",
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
    mode: "windowed",
    view: "groups",
  });

  // Even with every selection set, only the active view's action shows.
  expect(groups).toEqual({
    showGrantDetailBackAction: false,
    showGroupDetailBackAction: true,
    showRosterDetailBackAction: false,
  });
});

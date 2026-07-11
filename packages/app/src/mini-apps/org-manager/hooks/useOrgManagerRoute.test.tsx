import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { WindowStateProvider } from "../../../components/window/WindowStateProvider";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import type { MiniAppDefinition, MiniAppId } from "../../types";
import { useOrgManagerRoute } from "./useOrgManagerRoute";

const groups = [{ groupId: "admins" }, { groupId: "members" }] as const;

const EmptyMiniApp = () => null;

const TEST_MINI_APPS: Readonly<Record<MiniAppId, MiniAppDefinition>> = {
  "backup-restore": { createComponent: () => EmptyMiniApp, title: "Backup" },
  contacts: { createComponent: () => EmptyMiniApp, title: "Contacts" },
  explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
  "identity-manager": { createComponent: () => EmptyMiniApp, title: "ID" },
  notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
  "org-manager": { createComponent: () => EmptyMiniApp, title: "Org Manager" },
  "system-monitor": {
    createComponent: () => EmptyMiniApp,
    title: "System Monitor",
  },
};

function RoutedWrapper({ children }: { children: ReactNode }) {
  return (
    <WindowStateProvider>
      <AppNavigationProvider mode="routed" miniApps={TEST_MINI_APPS}>
        {children}
      </AppNavigationProvider>
    </WindowStateProvider>
  );
}

test("routed org manager opens on the section menu, not the roster", () => {
  const view = renderHook(() => useOrgManagerRoute({ groups }), {
    wrapper: RoutedWrapper,
  });

  expect(view.result.current.route.view).toBe("menu");

  act(() => {
    view.result.current.setView("grants");
  });

  expect(view.result.current.route.view).toBe("grants");
});

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

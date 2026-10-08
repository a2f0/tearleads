import { expect, test } from "bun:test";
import type { WindowEntry } from "../window/WindowStateProvider";
import type { LauncherDefinition } from "./launcherDefinition";
import { resolveActiveLauncherRoute } from "./useActiveLauncherRoute";

const EmptyMiniApp = () => null;
const TEST_LAUNCHER: LauncherDefinition = {
  apps: {
    contacts: { createComponent: () => EmptyMiniApp, title: "Contacts" },
    notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
    "org-manager": { createComponent: () => EmptyMiniApp, title: "Orgs" },
  },
};

function windowEntry(overrides: Partial<WindowEntry>): WindowEntry {
  return {
    id: "window",
    initialX: 0,
    initialY: 0,
    maximized: false,
    minimized: false,
    title: "Window",
    zIndex: 1,
    ...overrides,
  };
}

test("active launcher route follows routed navigation", () => {
  const route = { appId: "org-manager", pathSegments: ["billing"] } as const;
  expect(
    resolveActiveLauncherRoute(TEST_LAUNCHER, "routed", route, []),
  ).toEqual(route);
});

test("active launcher route uses the top visible mini-app window", () => {
  const route = resolveActiveLauncherRoute(
    TEST_LAUNCHER,
    "windowed",
    { appId: null, pathSegments: [] },
    [
      windowEntry({ appId: "contacts", zIndex: 2 }),
      windowEntry({ appId: "notes", minimized: true, zIndex: 5 }),
      windowEntry({ zIndex: 8 }),
      windowEntry({
        appId: "org-manager",
        pathSegments: ["billing"],
        zIndex: 4,
      }),
    ],
  );
  expect(route).toEqual({ appId: "org-manager", pathSegments: ["billing"] });
});

test("active launcher route is empty without a visible mini-app window", () => {
  expect(
    resolveActiveLauncherRoute(
      TEST_LAUNCHER,
      "windowed",
      { appId: "contacts", pathSegments: [] },
      [
        windowEntry({ appId: "contacts", minimized: true }),
        windowEntry({ zIndex: 3 }),
      ],
    ),
  ).toEqual({ appId: null, pathSegments: [] });
});

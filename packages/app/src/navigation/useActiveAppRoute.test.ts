import { expect, test } from "bun:test";
import type { WindowEntry } from "../components/window/WindowStateProvider";
import { resolveActiveAppRoute } from "./useActiveAppRoute";

function windowEntry(overrides: Partial<WindowEntry>): WindowEntry {
  return {
    id: "window",
    initialX: 0,
    initialY: 0,
    minimized: false,
    title: "Window",
    zIndex: 1,
    ...overrides,
  };
}

test("active app route follows routed navigation", () => {
  const route = { appId: "org-manager", pathSegments: ["billing"] } as const;
  expect(resolveActiveAppRoute("routed", route, [])).toBe(route);
});

test("active app route uses the top visible mini-app window", () => {
  const route = resolveActiveAppRoute(
    "windowed",
    { appId: null, pathSegments: [] },
    [
      windowEntry({ appId: "contacts", zIndex: 2 }),
      windowEntry({ appId: "notes", minimized: true, zIndex: 5 }),
      windowEntry({ zIndex: 8 }),
      windowEntry({
        appId: "org-manager",
        miniAppPathSegments: ["billing"],
        zIndex: 4,
      }),
    ],
  );
  expect(route).toEqual({ appId: "org-manager", pathSegments: ["billing"] });
});

test("active app route is empty without a visible mini-app window", () => {
  expect(
    resolveActiveAppRoute("windowed", { appId: "contacts", pathSegments: [] }, [
      windowEntry({ appId: "contacts", minimized: true }),
      windowEntry({ zIndex: 3 }),
    ]),
  ).toEqual({ appId: null, pathSegments: [] });
});

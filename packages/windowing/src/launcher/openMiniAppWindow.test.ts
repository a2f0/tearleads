import { expect, test } from "bun:test";
import type {
  WindowCreateOptions,
  WindowEntry,
} from "../window/WindowStateProvider";
import type { LauncherDefinition } from "./launcherDefinition";
import {
  DEFAULT_MINI_APP_POSITION,
  type MiniAppWindowPlacement,
  type OpenMiniAppRequest,
  openMiniAppWindow,
} from "./openMiniAppWindow";

const EmptyApp = () => null;
const DEFINITION: LauncherDefinition = {
  apps: {
    notes: {
      createComponent: () => EmptyApp,
      title: "Notes",
      windowSize: { height: 300, width: 400 },
    },
  },
};

interface Created {
  options: WindowCreateOptions | undefined;
  x: number;
  y: number;
}

function open({
  placement,
  request = { appId: "notes" },
  windows = [],
}: {
  placement?: MiniAppWindowPlacement;
  request?: OpenMiniAppRequest;
  windows?: WindowEntry[];
}) {
  const created: Created[] = [];
  const raised: string[] = [];
  const placed: OpenMiniAppRequest[] = [];
  const id = openMiniAppWindow({
    actions: {
      bringToFront: (windowId) => raised.push(windowId),
      create: (_title, x, y, _component, options) => {
        created.push({ options, x, y });
        return "new";
      },
      restore: () => {},
      updateRoute: () => {},
    },
    definition: DEFINITION,
    placeWindow:
      placement === undefined
        ? undefined
        : (placedRequest) => {
            placed.push(placedRequest);
            return placement;
          },
    request,
    windows,
  });
  return { created, id, placed, raised };
}

test("without a placement, a window opens at the request's position or the default, at the app's size", () => {
  expect(open({}).created).toEqual([
    {
      options: {
        appId: "notes",
        initialShowSidebar: undefined,
        size: { height: 300, width: 400 },
      },
      ...DEFAULT_MINI_APP_POSITION,
    },
  ]);
  expect(
    open({ request: { appId: "notes", position: { x: 5, y: 6 } } }).created[0],
  ).toMatchObject({ x: 5, y: 6 });
});

test("the host's placement wins over the request and the app's size", () => {
  const request = { appId: "notes", position: { x: 5, y: 6 } };
  const { created, placed } = open({
    placement: {
      fitToContent: true,
      position: { x: 40, y: 50 },
      size: { height: 100, width: 200 },
    },
    request,
  });
  expect(placed).toEqual([request]);
  expect(created).toEqual([
    {
      options: {
        appId: "notes",
        fitToContent: true,
        initialShowSidebar: undefined,
        size: { height: 100, width: 200 },
      },
      x: 40,
      y: 50,
    },
  ]);
});

test("a placement that leaves fields out keeps the request's position and the app's size", () => {
  const { created } = open({
    placement: {},
    request: { appId: "notes", position: { x: 5, y: 6 } },
  });
  expect(created).toEqual([
    {
      options: {
        appId: "notes",
        initialShowSidebar: undefined,
        size: { height: 300, width: 400 },
      },
      x: 5,
      y: 6,
    },
  ]);
});

test("an open window is raised without placing a new one", () => {
  const existing: WindowEntry = {
    appId: "notes",
    component: EmptyApp,
    id: "w1",
    initialX: 0,
    initialY: 0,
    maximized: false,
    minimized: true,
    title: "Notes",
    zIndex: 1,
  };
  const { created, id, placed, raised } = open({
    placement: { position: { x: 1, y: 1 } },
    windows: [existing],
  });
  expect({ created, id, placed, raised }).toEqual({
    created: [],
    id: "w1",
    placed: [],
    raised: ["w1"],
  });
});

import {
  findTopWindow,
  type WindowSize,
  type WindowStateActions,
  type WindowStateData,
} from "../window/WindowStateProvider";
import type { LauncherDefinition } from "./launcherDefinition";

/** Where a new window opens when a request names no position. */
export const DEFAULT_MINI_APP_POSITION = { x: 200, y: 160 };

/** A request to show an app: in a window, or as the routed shell's page. */
export interface OpenMiniAppRequest<AppId extends string = string> {
  appId: AppId;
  pathSegments?: ReadonlyArray<string> | undefined;
  /** Where a new window opens. */
  position?: { x: number; y: number } | undefined;
  /** Raise the app's open window instead of opening another. Defaults to true. */
  reuseExisting?: boolean | undefined;
}

/** Where a host opens a new window for an app, and how. */
export interface MiniAppWindowPlacement {
  /**
   * Open the window fitted to its content, once the content has loaded, as
   * `create`'s `fitToContent` does.
   */
  fitToContent?: boolean | undefined;
  /**
   * Where the window opens, in viewport pixels like a request's `position`.
   * Defaults to the request's position.
   */
  position?: { x: number; y: number } | undefined;
  /** The window's size. Defaults to the app's `windowSize`. */
  size?: WindowSize | undefined;
}

/**
 * Places a new window: the host's own geometry for the app a request opens,
 * read when the window opens.
 */
export type PlaceMiniAppWindow = (
  request: OpenMiniAppRequest,
) => MiniAppWindowPlacement;

/**
 * Raises the app's open window or opens a new one where `placeWindow` puts
 * it, else at the request's position or {@link DEFAULT_MINI_APP_POSITION},
 * sized by the app's `windowSize`. Returns the window's id.
 */
export function openMiniAppWindow({
  actions,
  definition,
  placeWindow,
  request,
  windows,
}: {
  actions: Pick<
    WindowStateActions,
    "bringToFront" | "create" | "restore" | "updateRoute"
  >;
  definition: LauncherDefinition;
  placeWindow: PlaceMiniAppWindow | undefined;
  request: OpenMiniAppRequest;
  windows: WindowStateData["windows"];
}): string {
  const { appId, pathSegments, reuseExisting = true } = request;
  const existingWindow = reuseExisting
    ? findTopWindow(windows, (windowEntry) => windowEntry.appId === appId)
    : null;
  if (existingWindow) {
    actions.restore(existingWindow.id);
    actions.bringToFront(existingWindow.id);
    if (pathSegments) {
      actions.updateRoute(existingWindow.id, pathSegments);
    }
    return existingWindow.id;
  }

  const app = definition.apps[appId];
  if (!app) {
    throw new Error(`Unknown mini-app: ${appId}`);
  }
  const placement = placeWindow?.(request) ?? {};
  const position =
    placement.position ?? request.position ?? DEFAULT_MINI_APP_POSITION;
  const size = placement.size ?? app.windowSize;
  return actions.create(
    app.title,
    position.x,
    position.y,
    app.createComponent(),
    {
      appId,
      initialShowSidebar: app.initialShowSidebar,
      ...(placement.fitToContent ? { fitToContent: true } : {}),
      ...(pathSegments ? { pathSegments } : {}),
      ...(size ? { size } : {}),
    },
  );
}

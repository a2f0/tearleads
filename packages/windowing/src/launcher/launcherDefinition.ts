import type { ComponentType } from "react";
import type { WindowingIcon } from "../icons/windowingIcon";

/** One app a launcher opens: in a window, or as the routed shell's page. */
export interface MiniAppDefinition {
  /**
   * Builds the app's component. A window calls it when it opens, and the
   * routed shell when it shows the app, so each gets its own component.
   */
  createComponent: () => ComponentType;
  /** The app's glyph in the launchers and the taskbar. */
  icon?: WindowingIcon | undefined;
  /**
   * Whether the app's sidebar starts shown, in a new window and on the routed
   * shell's tablet tier. Defaults to shown. The phone tier always starts with
   * the sidebar hidden.
   */
  initialShowSidebar?: boolean | undefined;
  title: string;
}

/**
 * A launcher application: the mini-apps it can open, the order its launchers
 * list them in, and the one the routed shell shows at the root route.
 */
export interface LauncherDefinition<AppId extends string = string> {
  apps: Readonly<Record<AppId, MiniAppDefinition>>;
  /** Shown at the root route. Defaults to the first app in `order`. */
  homeAppId?: AppId | undefined;
  /**
   * The order the launchers list the apps in. Ids with no app in `apps` are
   * skipped. Defaults to the order of `apps`' keys.
   */
  order?: ReadonlyArray<AppId> | undefined;
}

/** Narrows an opaque window `appId` to one of the launcher's apps. */
export function isLauncherAppId<AppId extends string>(
  definition: LauncherDefinition<AppId>,
  value: string | null | undefined,
): value is AppId {
  return typeof value === "string" && Object.hasOwn(definition.apps, value);
}

/** The launcher's apps in the order its launchers list them. */
export function resolveLauncherOrder<AppId extends string>(
  definition: LauncherDefinition<AppId>,
): ReadonlyArray<AppId> {
  const order: ReadonlyArray<string> =
    definition.order ?? Object.keys(definition.apps);
  return order.filter((appId) => isLauncherAppId(definition, appId));
}

/** The app the routed shell shows at the root route, if the launcher has any. */
export function resolveLauncherHomeAppId<AppId extends string>(
  definition: LauncherDefinition<AppId>,
): AppId | null {
  if (
    definition.homeAppId !== undefined &&
    isLauncherAppId(definition, definition.homeAppId)
  ) {
    return definition.homeAppId;
  }
  return resolveLauncherOrder(definition)[0] ?? null;
}

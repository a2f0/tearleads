import type { WindowMenuItem } from "./WindowMenuBar";

/*
 * The shapes a mini-app's menu registration takes, and the pure projections
 * from a registry map to the items a menu bar (or the routed app bar) renders.
 * The React seams — the context, the provider, and the register/read hooks —
 * live in WindowMenuContext.tsx.
 */

export const REFRESH_LABEL = "Refresh";
const REFRESHING_LABEL = "Refreshing...";

export interface RegisteredWindowMenuItem {
  disabled: boolean;
  id: string;
  label: string;
  onClick: () => unknown;
  priority: number;
}

export interface RegisteredWindowRefreshMenuItem {
  disabled: boolean;
  label: string;
  onRefresh: () => unknown;
  priority: number;
  refreshing: boolean;
}

export function sameMenuItem(
  left: RegisteredWindowMenuItem | undefined,
  right: RegisteredWindowMenuItem,
): boolean {
  return (
    left !== undefined &&
    left.disabled === right.disabled &&
    left.id === right.id &&
    left.label === right.label &&
    left.onClick === right.onClick &&
    left.priority === right.priority
  );
}

export function sameRefreshMenuItem(
  left: RegisteredWindowRefreshMenuItem | undefined,
  right: RegisteredWindowRefreshMenuItem,
): boolean {
  return (
    left !== undefined &&
    left.disabled === right.disabled &&
    left.label === right.label &&
    left.onRefresh === right.onRefresh &&
    left.priority === right.priority &&
    left.refreshing === right.refreshing
  );
}

export function createMenuItems(
  items: ReadonlyMap<object, RegisteredWindowMenuItem>,
): WindowMenuItem[] {
  return Array.from(items.values())
    .sort((left, right) => right.priority - left.priority)
    .map((item) => ({
      disabled: item.disabled,
      id: item.id,
      label: item.label,
      onClick: () => {
        void item.onClick();
      },
    }));
}

export function createRefreshMenuItem(
  item: RegisteredWindowRefreshMenuItem | null,
): WindowMenuItem | null {
  if (!item) {
    return null;
  }

  return {
    disabled: item.disabled || item.refreshing,
    id: "window-refresh",
    label: item.refreshing ? REFRESHING_LABEL : item.label,
    onClick: () => {
      void item.onRefresh();
    },
  };
}

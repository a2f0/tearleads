import type { ReactNode } from "react";
import { useWindowItemRegistration } from "./useWindowItemRegistration";
import type { WindowTitleBarAction } from "./WindowTitleBar";

export interface WindowTitleBarActionInput {
  disabled?: boolean;
  icon: ReactNode;
  id: string;
  label: string;
  onClick: () => unknown;
  /**
   * Reserves the slot immediately left of the lowest-priority toolbar action.
   * If multiple actions request it, the highest-priority action wins, with the
   * action id providing a deterministic tie-break. A sole action stays sole.
   */
  placement?: "penultimate";
  priority?: number;
}

export interface WindowBackActionInput {
  disabled?: boolean;
  label: string;
  onClick: () => unknown;
  priority?: number;
}

export interface RegisteredWindowTitleBarAction {
  disabled: boolean;
  icon: ReactNode;
  id: string;
  label: string;
  onClick: () => unknown;
  placement: "penultimate" | null;
  priority: number;
}

export interface RegisteredWindowBackAction {
  disabled: boolean;
  label: string;
  onClick: () => unknown;
  priority: number;
}

export interface WindowBackAction {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

export function createTitleBarActions(
  items: ReadonlyMap<object, RegisteredWindowTitleBarAction>,
): WindowTitleBarAction[] {
  const ordered = Array.from(items.values()).sort(
    (left, right) =>
      right.priority - left.priority ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  const penultimateIndex = ordered.findIndex(
    (item) => item.placement === "penultimate",
  );
  if (penultimateIndex >= 0 && ordered.length > 1) {
    const [penultimate] = ordered.splice(penultimateIndex, 1);
    if (penultimate) {
      ordered.splice(ordered.length - 1, 0, penultimate);
    }
  }

  return ordered.map((item) => ({
    disabled: item.disabled,
    icon: item.icon,
    id: item.id,
    label: item.label,
    onClick: () => {
      void item.onClick();
    },
  }));
}

function createRegisteredTitleBarAction(
  item: WindowTitleBarActionInput,
  onClick: () => unknown,
): RegisteredWindowTitleBarAction | null {
  if (!item.icon) {
    return null;
  }

  return {
    disabled: item.disabled ?? false,
    icon: item.icon,
    id: item.id,
    label: item.label,
    onClick,
    placement: item.placement ?? null,
    priority: item.priority ?? 0,
  };
}

function createRegisteredBackAction(
  item: WindowBackActionInput,
  onClick: () => unknown,
): RegisteredWindowBackAction {
  return {
    disabled: item.disabled ?? false,
    label: item.label,
    onClick,
    priority: item.priority ?? 0,
  };
}

export function createBackAction(
  item: RegisteredWindowBackAction | null,
): WindowBackAction | null {
  if (!item) {
    return null;
  }

  return {
    disabled: item.disabled,
    label: item.label,
    onClick: () => {
      void item.onClick();
    },
  };
}

export function useRegisteredWindowTitleBarAction(
  item: WindowTitleBarActionInput | null,
  registerTitleBarAction: (
    id: object,
    item: RegisteredWindowTitleBarAction,
  ) => void,
  unregisterTitleBarAction: (id: object) => void,
): void {
  useWindowItemRegistration({
    action: item?.onClick ?? null,
    createRegisteredItem: createRegisteredTitleBarAction,
    input: item,
    registerItem: registerTitleBarAction,
    unregisterItem: unregisterTitleBarAction,
  });
}

export function useRegisteredWindowBackAction(
  item: WindowBackActionInput | null,
  registerBackAction: (id: object, item: RegisteredWindowBackAction) => void,
  unregisterBackAction: (id: object) => void,
): void {
  useWindowItemRegistration({
    action: item?.onClick ?? null,
    createRegisteredItem: createRegisteredBackAction,
    input: item,
    registerItem: registerBackAction,
    unregisterItem: unregisterBackAction,
  });
}

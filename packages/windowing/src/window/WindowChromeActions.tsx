import type { ReactNode } from "react";
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
  /**
   * Makes the action a toggle: the button announces this value as
   * `aria-pressed` and the toolbar draws it pressed while true. Leave it unset
   * for an action that is not a toggle.
   */
  pressed?: boolean;
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
  pressed: boolean | null;
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

/**
 * The registered title-bar actions rendered as icon buttons — the shared markup
 * behind the windowed toolbar row and the routed app bar, which differ only in
 * their button class.
 */
export function WindowTitleBarActionButtons({
  actions,
  className,
}: {
  actions: ReadonlyArray<WindowTitleBarAction>;
  className: string;
}) {
  return (
    <>
      {actions.map((action) => (
        <button
          aria-label={action.label}
          className={className}
          aria-pressed={action.pressed}
          disabled={action.disabled}
          key={action.id}
          title={action.label}
          type="button"
          onClick={action.onClick}
        >
          {action.icon}
        </button>
      ))}
    </>
  );
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
    ...(item.pressed === null ? {} : { pressed: item.pressed }),
  }));
}

export function createRegisteredTitleBarAction(
  item: WindowTitleBarActionInput,
  onClick: () => unknown,
): RegisteredWindowTitleBarAction {
  return {
    disabled: item.disabled ?? false,
    icon: item.icon,
    id: item.id,
    label: item.label,
    onClick,
    placement: item.placement ?? null,
    pressed: item.pressed ?? null,
    priority: item.priority ?? 0,
  };
}

export function createRegisteredBackAction(
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

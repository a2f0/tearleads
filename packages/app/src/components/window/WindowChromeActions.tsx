import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
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

export function sameTitleBarAction(
  left: RegisteredWindowTitleBarAction | undefined,
  right: RegisteredWindowTitleBarAction,
): boolean {
  return (
    left !== undefined &&
    left.disabled === right.disabled &&
    left.icon === right.icon &&
    left.id === right.id &&
    left.label === right.label &&
    left.onClick === right.onClick &&
    left.placement === right.placement &&
    left.priority === right.priority
  );
}

export function sameBackAction(
  left: RegisteredWindowBackAction | undefined,
  right: RegisteredWindowBackAction,
): boolean {
  return (
    left !== undefined &&
    left.disabled === right.disabled &&
    left.label === right.label &&
    left.onClick === right.onClick &&
    left.priority === right.priority
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
  }));
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
  const registrationIdRef = useRef<object>({});
  const onClickRef = useRef<WindowTitleBarActionInput["onClick"] | null>(null);
  const enabled = item !== null;
  const disabled = item?.disabled ?? false;
  const icon = item?.icon ?? null;
  const itemId = item?.id ?? "";
  const label = item?.label ?? "";
  const onClick = item?.onClick ?? null;
  const placement = item?.placement ?? null;
  const priority = item?.priority ?? 0;

  useLayoutEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  const handleClick = useCallback(() => {
    return onClickRef.current?.();
  }, []);

  useEffect(() => {
    const registrationId = registrationIdRef.current;

    if (!enabled || !icon) {
      return;
    }

    registerTitleBarAction(registrationId, {
      disabled,
      icon,
      id: itemId,
      label,
      onClick: handleClick,
      placement,
      priority,
    });

    return () => unregisterTitleBarAction(registrationId);
  }, [
    disabled,
    enabled,
    handleClick,
    icon,
    itemId,
    label,
    placement,
    priority,
    registerTitleBarAction,
    unregisterTitleBarAction,
  ]);
}

export function useRegisteredWindowBackAction(
  item: WindowBackActionInput | null,
  registerBackAction: (id: object, item: RegisteredWindowBackAction) => void,
  unregisterBackAction: (id: object) => void,
): void {
  const registrationIdRef = useRef<object>({});
  const onClickRef = useRef<WindowBackActionInput["onClick"] | null>(null);
  const enabled = item !== null;
  const disabled = item?.disabled ?? false;
  const label = item?.label ?? "";
  const onClick = item?.onClick ?? null;
  const priority = item?.priority ?? 0;

  useLayoutEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  const handleClick = useCallback(() => {
    return onClickRef.current?.();
  }, []);

  useEffect(() => {
    const registrationId = registrationIdRef.current;

    if (!enabled) {
      return;
    }

    registerBackAction(registrationId, {
      disabled,
      label,
      onClick: handleClick,
      priority,
    });

    return () => unregisterBackAction(registrationId);
  }, [
    disabled,
    enabled,
    handleClick,
    label,
    priority,
    registerBackAction,
    unregisterBackAction,
  ]);
}

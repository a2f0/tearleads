import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { sameWindowItem } from "./useWindowItemRegistry";

type WindowItemAction = () => unknown;

interface WindowItemRegistrationOptions<Input, RegisteredItem extends object> {
  action: WindowItemAction | null;
  createRegisteredItem: (
    input: Input,
    handleAction: WindowItemAction,
  ) => RegisteredItem | null;
  input: Input | null;
  registerItem: (id: object, item: RegisteredItem) => void;
  unregisterItem: (id: object) => void;
}

function useStableWindowItem<T extends object>(item: T | null): T | null {
  const stableItemRef = useRef<T | null>(null);
  const stableItem = stableItemRef.current;

  if (
    (item === null && stableItem !== null) ||
    (item !== null &&
      (stableItem === null || !sameWindowItem(stableItem, item)))
  ) {
    stableItemRef.current = item;
  }

  return stableItemRef.current;
}

export function useWindowItemRegistration<Input, RegisteredItem extends object>(
  options: WindowItemRegistrationOptions<Input, RegisteredItem>,
): void {
  const { action, createRegisteredItem, input, registerItem, unregisterItem } =
    options;
  const actionRef = useRef<WindowItemAction | null>(null);
  const registrationIdRef = useRef<object>({});

  useLayoutEffect(() => {
    actionRef.current = action;
  }, [action]);

  const handleAction = useCallback(() => actionRef.current?.(), []);
  const registeredItem = useStableWindowItem(
    input === null ? null : createRegisteredItem(input, handleAction),
  );

  useEffect(() => {
    if (registeredItem === null) {
      return;
    }

    const registrationId = registrationIdRef.current;
    registerItem(registrationId, registeredItem);
    return () => unregisterItem(registrationId);
  }, [registeredItem, registerItem, unregisterItem]);
}

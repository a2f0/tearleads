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

interface ActiveWindowItemRegistration<T extends object> {
  readonly item: T | null;
  readonly registerItem: (id: object, item: T) => void;
  readonly unregisterItem: (id: object) => void;
}

export function useWindowItemRegistration<Input, RegisteredItem extends object>(
  options: WindowItemRegistrationOptions<Input, RegisteredItem>,
): void {
  const { action, createRegisteredItem, input, registerItem, unregisterItem } =
    options;
  const actionRef = useRef<WindowItemAction | null>(null);
  const activeRegistrationRef =
    useRef<ActiveWindowItemRegistration<RegisteredItem> | null>(null);
  const registrationIdRef = useRef<object>({});

  useLayoutEffect(() => {
    actionRef.current = action;
  }, [action]);

  const handleAction = useCallback(() => actionRef.current?.(), []);
  const registeredItem =
    input === null ? null : createRegisteredItem(input, handleAction);

  useEffect(() => {
    const activeRegistration = activeRegistrationRef.current;
    const activeItem = activeRegistration?.item ?? null;
    const itemMatches =
      activeItem === registeredItem ||
      (activeItem !== null &&
        registeredItem !== null &&
        sameWindowItem(activeItem, registeredItem));
    if (
      itemMatches &&
      activeRegistration?.registerItem === registerItem &&
      activeRegistration.unregisterItem === unregisterItem
    ) {
      return;
    }

    const registrationId = registrationIdRef.current;
    if (activeRegistration?.item) {
      activeRegistration.unregisterItem(registrationId);
    }
    if (registeredItem) {
      registerItem(registrationId, registeredItem);
    }
    activeRegistrationRef.current = {
      item: registeredItem,
      registerItem,
      unregisterItem,
    };
  });

  useEffect(
    () => () => {
      const activeRegistration = activeRegistrationRef.current;
      if (activeRegistration?.item) {
        activeRegistration.unregisterItem(registrationIdRef.current);
      }
      activeRegistrationRef.current = null;
    },
    [],
  );
}

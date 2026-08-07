import { useMemo } from "react";
import { useWindowItemRegistry } from "./useWindowItemRegistry";

interface WindowToolbarReservationRegistry {
  register: (id: object, reserved: boolean) => void;
  released: boolean;
  reserved: boolean;
  unregister: (id: object) => void;
}

function sameToolbarReservation(
  left: boolean | undefined,
  right: boolean,
): boolean {
  return left === right;
}

export function useWindowToolbarReservationRegistry(): WindowToolbarReservationRegistry {
  const reservation = useWindowItemRegistry<boolean>(sameToolbarReservation);
  const reserved = Array.from(reservation.items.values()).some(Boolean);
  const released = reservation.items.size > 0 && !reserved;

  return useMemo(
    () => ({
      register: reservation.registerItem,
      released,
      reserved,
      unregister: reservation.unregisterItem,
    }),
    [released, reserved, reservation.registerItem, reservation.unregisterItem],
  );
}

import { useCallback, useMemo } from "react";
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
  const register = useCallback(
    (id: object, reserved: boolean) => reservation.registerItem(id, reserved),
    [reservation.registerItem],
  );
  const reserved = Array.from(reservation.items.values()).some(Boolean);
  const released = reservation.items.size > 0 && !reserved;

  return useMemo(
    () => ({
      register,
      released,
      reserved,
      unregister: reservation.unregisterItem,
    }),
    [register, released, reserved, reservation.unregisterItem],
  );
}

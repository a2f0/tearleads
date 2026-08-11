import { useMemo } from "react";
import { useWindowItemRegistry } from "./useWindowItemRegistry";

interface WindowToolbarReservationRegistry {
  register: (id: object, reserved: boolean) => void;
  released: boolean;
  reserved: boolean;
  unregister: (id: object) => void;
}

// Module scope on purpose: the registry keys its callback identities on the
// comparator, so an inline closure here re-registers every render and loops.
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

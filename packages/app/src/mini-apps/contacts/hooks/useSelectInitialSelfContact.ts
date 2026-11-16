import { useEffect, useRef } from "react";
import { findCurrentSelfContactLocalId } from "../../../stores/contacts/contactLabels";
import type { SelfContactIdentityView } from "../../../stores/contacts/currentSelfContactIdentityState";
import type { ContactsRoute } from "../routes";
import type { ContactEntries } from "../types";

/** Opens Contacts on the self contact until the user picks a route. */
export function useSelectInitialSelfContact(input: {
  enabled: boolean;
  entries: ContactEntries;
  hasRequestedRoute: () => boolean;
  ready: boolean;
  route: ContactsRoute;
  selectedContactId: string | null;
  selfContactIdentity: SelfContactIdentityView;
  setSelectedContactId: (contactId: string) => void;
}) {
  const {
    enabled,
    entries,
    hasRequestedRoute,
    ready,
    route,
    selectedContactId,
    selfContactIdentity,
    setSelectedContactId,
  } = input;
  const selectedInitialSelfRef = useRef(false);

  useEffect(() => {
    // `route` and `selectedContactId` are this render's values. A contact the
    // user picked after this render is not committed yet, so also stop once
    // any route has been requested.
    if (
      !enabled ||
      !ready ||
      route !== "selection" ||
      selectedInitialSelfRef.current ||
      selectedContactId !== null ||
      hasRequestedRoute()
    ) {
      return;
    }

    const selfId = findCurrentSelfContactLocalId(entries, selfContactIdentity);
    if (!selfId) {
      return;
    }
    selectedInitialSelfRef.current = true;
    setSelectedContactId(selfId);
  }, [
    enabled,
    entries,
    hasRequestedRoute,
    ready,
    route,
    selectedContactId,
    selfContactIdentity,
    setSelectedContactId,
  ]);
}

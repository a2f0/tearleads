export type ContactsRoute = "selection" | "new-contact" | "import-contact";

export interface ContactsRouteSnapshot {
  route: ContactsRoute;
  selectedContactId: string | null;
}

export const DEFAULT_CONTACTS_ROUTE_SNAPSHOT: ContactsRouteSnapshot = {
  route: "selection",
  selectedContactId: null,
};

export function parseContactsRouteSegments(
  pathSegments: ReadonlyArray<string>,
): ContactsRouteSnapshot {
  const [firstSegment, secondSegment] = pathSegments;
  if (firstSegment === "new") {
    return { route: "new-contact", selectedContactId: null };
  }

  if (firstSegment === "import") {
    return { route: "import-contact", selectedContactId: null };
  }

  if (firstSegment === "contact" && secondSegment) {
    return { route: "selection", selectedContactId: secondSegment };
  }

  return DEFAULT_CONTACTS_ROUTE_SNAPSHOT;
}

export function formatContactsRouteSegments({
  route,
  selectedContactId,
}: ContactsRouteSnapshot): ReadonlyArray<string> {
  if (route === "new-contact") {
    return ["new"];
  }

  if (route === "import-contact") {
    return ["import"];
  }

  return selectedContactId ? ["contact", selectedContactId] : [];
}

export type RootView = "menu" | "identities";

export type RootRoute =
  | { readonly view: "menu" }
  | { readonly userId: string | null; readonly view: "identities" };

export const MENU_ROOT_ROUTE: RootRoute = { view: "menu" };
export const IDENTITIES_ROOT_ROUTE: RootRoute = {
  userId: null,
  view: "identities",
};

export function parseRootRouteSegments(
  pathSegments: ReadonlyArray<string>,
): RootRoute {
  const [view, userId] = pathSegments;
  if (view === "identities") {
    return { userId: userId && userId.length > 0 ? userId : null, view };
  }
  return MENU_ROOT_ROUTE;
}

export function formatRootRouteSegments(
  route: RootRoute,
): ReadonlyArray<string> {
  if (route.view === "menu") {
    return [];
  }
  return route.userId === null ? ["identities"] : ["identities", route.userId];
}

export function rootRouteForView(view: RootView): RootRoute {
  return view === "identities" ? IDENTITIES_ROOT_ROUTE : MENU_ROOT_ROUTE;
}

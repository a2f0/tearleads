export type IdentityManagerView =
  | "menu"
  | "general"
  | "recovery-key"
  | "pin-lock"
  | "two-factor"
  | "active-sessions"
  | "local-data";

export function parseIdentityManagerRouteSegments(
  pathSegments: ReadonlyArray<string>,
): IdentityManagerView {
  const [view] = pathSegments;

  if (
    view === "general" ||
    view === "recovery-key" ||
    view === "pin-lock" ||
    view === "two-factor" ||
    view === "active-sessions" ||
    view === "local-data"
  ) {
    return view;
  }

  return "menu";
}

export function formatIdentityManagerRouteSegments(
  view: IdentityManagerView,
): ReadonlyArray<string> {
  return view === "menu" ? [] : [view];
}

export type IdentityManagerView =
  | "menu"
  | "general"
  | "recovery-key"
  | "pin-lock"
  | "active-sessions";

export function parseIdentityManagerRouteSegments(
  pathSegments: ReadonlyArray<string>,
): IdentityManagerView {
  const [view] = pathSegments;

  if (
    view === "general" ||
    view === "recovery-key" ||
    view === "pin-lock" ||
    view === "active-sessions"
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

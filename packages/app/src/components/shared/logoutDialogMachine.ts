import type { DomainScope } from "@tearleads/client-sdk";

type LogoutDialogState =
  | { readonly status: "closed" }
  | {
      readonly status: "open";
      readonly scope: DomainScope;
      readonly request: symbol;
    };
type LogoutDialogEvent =
  | {
      readonly type: "open";
      readonly scope: DomainScope;
      readonly request: symbol;
    }
  | { readonly type: "close"; readonly request: symbol };
export function transitionLogoutDialog(
  state: LogoutDialogState,
  event: LogoutDialogEvent,
): LogoutDialogState {
  if (event.type === "open")
    return { status: "open", scope: event.scope, request: event.request };
  return state.status === "open" && state.request === event.request
    ? { status: "closed" }
    : state;
}

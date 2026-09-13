import type { WsConnection, WsEventRouter } from "../../src/realtime/wsRouting";

// Routing tests supply trusted interest; gateway tests exercise authorization.
export function applyContainerInterest(
  router: WsEventRouter,
  ws: WsConnection,
  message: string,
) {
  const action = router.handleClientMessage(ws, message);
  if (action && action.kind !== "organization-replace") {
    router.applyAuthorizedContainerInterest(ws, action);
  }
  return action;
}

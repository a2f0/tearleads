import {
  destroySessionOperation,
  isDestroySessionOperationResponse,
  isListSessionsOperationResponse,
  isLogoutOperationResponse,
  isUserIdentityOperationResponse,
  isWebSocketTicketOperationResponse,
  listSessionsOperation,
  logoutOperation,
  operationRequestPath,
  userIdentityOperation,
  webSocketTicketOperation,
} from "@symcrypt/validators/operation";

export const destroySession = {
  isResponse: isDestroySessionOperationResponse,
  method: destroySessionOperation.method,
  path(sessionId: string) {
    return operationRequestPath(destroySessionOperation, { sessionId });
  },
};

export const listSessions = {
  isResponse: isListSessionsOperationResponse,
  method: listSessionsOperation.method,
  path: operationRequestPath(listSessionsOperation, {}),
};

export const logout = {
  isResponse: isLogoutOperationResponse,
  method: logoutOperation.method,
  path: operationRequestPath(logoutOperation, {}),
};

export const userIdentity = {
  isResponse: isUserIdentityOperationResponse,
  method: userIdentityOperation.method,
  path(userId: string) {
    return operationRequestPath(userIdentityOperation, { userId });
  },
};

export const webSocketTicket = {
  isResponse: isWebSocketTicketOperationResponse,
  method: webSocketTicketOperation.method,
  path: operationRequestPath(webSocketTicketOperation, {}),
};

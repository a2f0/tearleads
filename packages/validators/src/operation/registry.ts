import {
  challengeOperation,
  destroySessionOperation,
  listSessionsOperation,
  logoutOperation,
  userIdentityOperation,
  verifyOperation,
  webSocketTicketOperation,
} from "./auth";
import { documentSyncOperation } from "./documentSync";

export const protocolOperations = [
  challengeOperation,
  destroySessionOperation,
  listSessionsOperation,
  logoutOperation,
  userIdentityOperation,
  verifyOperation,
  webSocketTicketOperation,
  documentSyncOperation,
] as const;

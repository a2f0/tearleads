import {
  challengeOperation,
  destroySessionOperation,
  listSessionsOperation,
  logoutOperation,
  registerOperation,
  userIdentityOperation,
  verifyOperation,
  webSocketTicketOperation,
} from "./auth";
import { documentSyncOperation } from "./documentSync";
import { createOrganizationOperation } from "./organizations";

export const protocolOperations = [
  challengeOperation,
  destroySessionOperation,
  listSessionsOperation,
  logoutOperation,
  registerOperation,
  userIdentityOperation,
  verifyOperation,
  webSocketTicketOperation,
  createOrganizationOperation,
  documentSyncOperation,
] as const;

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
import {
  createOrganizationOperation,
  getOrganizationDataUsageOperation,
} from "./organizations";

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
  getOrganizationDataUsageOperation,
  documentSyncOperation,
] as const;

import {
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  listDocumentAttachmentsOperation,
} from "./attachments";
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
import { getHealthOperation } from "./health";
import {
  completeMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
} from "./multipartBlobs";
import {
  createOrganizationGroupOperation,
  createOrganizationOperation,
  deleteOrganizationGroupOperation,
  getOrganizationDataUsageOperation,
  getOrganizationReadModelOperation,
  listOrganizationGroupMembersOperation,
  updateOrganizationProfileOperation,
  updateOrganizationRosterEntryOperation,
} from "./organizations";
import {
  getPrincipalPolicyOperation,
  putPrincipalPolicyOperation,
} from "./principals";

export const protocolOperations = [
  getHealthOperation,
  challengeOperation,
  destroySessionOperation,
  listSessionsOperation,
  logoutOperation,
  registerOperation,
  userIdentityOperation,
  verifyOperation,
  webSocketTicketOperation,
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  initiateMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  completeMultipartBlobStageOperation,
  listDocumentAttachmentsOperation,
  createOrganizationOperation,
  getOrganizationDataUsageOperation,
  getOrganizationReadModelOperation,
  createOrganizationGroupOperation,
  deleteOrganizationGroupOperation,
  listOrganizationGroupMembersOperation,
  updateOrganizationProfileOperation,
  updateOrganizationRosterEntryOperation,
  getPrincipalPolicyOperation,
  putPrincipalPolicyOperation,
  documentSyncOperation,
] as const;

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
import {
  getBlobBytesOperation,
  uploadMultipartBlobPartBytesOperation,
} from "./blobBytes";
import {
  getContainerKekLogOperation,
  listContainerDocumentsOperation,
  listContainerParentLanesOperation,
} from "./containerReads";
import {
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
} from "./documentAttribution";
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
import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
} from "./writerProjections";

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
  getBlobBytesOperation,
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  initiateMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  completeMultipartBlobStageOperation,
  uploadMultipartBlobPartBytesOperation,
  listDocumentAttachmentsOperation,
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
  getContainerKekLogOperation,
  listContainerDocumentsOperation,
  listContainerParentLanesOperation,
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
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

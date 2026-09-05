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
  receiveRevenueCatWebhookOperation,
  receiveStripeWebhookOperation,
} from "./billingWebhooks";
import {
  getBlobBytesOperation,
  uploadMultipartBlobPartBytesOperation,
} from "./blobBytes";
import {
  createContainerOperation,
  createContainerWithMetadataDocumentOperation,
  deleteContainerOperation,
  moveContainerOperation,
  reciteContainerOperation,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
} from "./containerMutations";
import {
  getContainerKekLogOperation,
  listContainerDocumentsOperation,
  listContainerParentLanesOperation,
} from "./containerReads";
import {
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
} from "./documentAttribution";
import {
  createDocumentOperation,
  getDocumentPurgeProofOperation,
  linkDocumentOperation,
  purgeDocumentOperation,
  unlinkDocumentOperation,
} from "./documentMutations";
import { documentSyncOperation } from "./documentSync";
import { getHealthOperation } from "./health";
import {
  completeMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
} from "./multipartBlobs";
import {
  claimNativeOrganizationSubscriptionOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationBillingOperation,
  getOrganizationNativePurchaseEligibilityOperation,
  startOrganizationTrialOperation,
} from "./organizationBilling";
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
  commitOrganizationGroupPolicyOperation,
  getPrincipalPolicyOperation,
  putPrincipalPolicyOperation,
} from "./principals";
import {
  cancelStripeSubscriptionOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  getStripeCheckoutOptionsOperation,
} from "./stripeCheckout";
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
  receiveRevenueCatWebhookOperation,
  receiveStripeWebhookOperation,
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  initiateMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  completeMultipartBlobStageOperation,
  uploadMultipartBlobPartBytesOperation,
  listDocumentAttachmentsOperation,
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
  createDocumentOperation,
  getDocumentPurgeProofOperation,
  linkDocumentOperation,
  purgeDocumentOperation,
  unlinkDocumentOperation,
  getContainerKekLogOperation,
  listContainerDocumentsOperation,
  listContainerParentLanesOperation,
  createContainerOperation,
  createContainerWithMetadataDocumentOperation,
  deleteContainerOperation,
  moveContainerOperation,
  reciteContainerOperation,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
  createOrganizationOperation,
  getOrganizationBillingOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationNativePurchaseEligibilityOperation,
  claimNativeOrganizationSubscriptionOperation,
  startOrganizationTrialOperation,
  getStripeCheckoutOptionsOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  cancelStripeSubscriptionOperation,
  getOrganizationDataUsageOperation,
  getOrganizationReadModelOperation,
  createOrganizationGroupOperation,
  deleteOrganizationGroupOperation,
  listOrganizationGroupMembersOperation,
  updateOrganizationProfileOperation,
  updateOrganizationRosterEntryOperation,
  getPrincipalPolicyOperation,
  commitOrganizationGroupPolicyOperation,
  putPrincipalPolicyOperation,
  documentSyncOperation,
] as const;

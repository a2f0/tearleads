import { ApiClientAreas } from "./client/apiClientAreas";

/**
 * The typed API client. Each method is implemented by one request area under
 * `client/` and published here as an instance property, so methods stay bound
 * when passed around or spread, and a replacement assigned on an instance is
 * honored by the methods built on it.
 */
export class ApiClient extends ApiClientAreas {
  // Connection hooks, session token, registration, and login.
  setOnError = this.session.setOnError;
  setOnNetworkError = this.session.setOnNetworkError;
  setOnNetworkSuccess = this.session.setOnNetworkSuccess;
  setOnNetworkFailure = this.session.setOnNetworkFailure;
  setOnApiVersion = this.session.setOnApiVersion;
  setOnSessionExpired = this.session.setOnSessionExpired;
  setOnPaymentRequired = this.session.setOnPaymentRequired;
  setVerifiedManifestCitations = this.session.setVerifiedManifestCitations;
  setAuthToken = this.session.setAuthToken;
  getAuthToken = this.session.getAuthToken;
  getRequestFailure = this.session.getRequestFailure;
  requestWebSocketTicket = this.session.requestWebSocketTicket;
  getHealth = this.session.getHealth;
  registerUser = this.session.registerUser;
  authenticate = this.session.authenticate;
  authenticateWithChallenge = this.session.authenticateWithChallenge;
  listSessions = this.session.listSessions;
  destroySession = this.session.destroySession;
  logout = this.session.logout;

  // Published user identities.
  getUserIdentity = this.identities.getUserIdentity;
  getUserIdentityRequestFailure = this.identities.getUserIdentityRequestFailure;
  evictUserIdentity = this.identities.evictUserIdentity;

  // Principal policies and organization groups.
  getPrincipalPolicyPages = this.policies.getPrincipalPolicyPages;
  getPrincipalPolicyDiscovery = this.policies.getPrincipalPolicyDiscovery;
  getPrincipalMemberEnvelopes = this.policies.getPrincipalMemberEnvelopes;
  getProjectionPolicyHistoryPages =
    this.policies.getProjectionPolicyHistoryPages;
  getCurrentPrincipalPolicy = this.policies.getCurrentPrincipalPolicy;
  putPrincipalPolicy = this.policies.putPrincipalPolicy;
  putPrincipalPolicyResult = this.policies.putPrincipalPolicyResult;
  commitOrganizationGroupPolicy = this.policies.commitOrganizationGroupPolicy;
  commitOrganizationGroupPolicyResult =
    this.policies.commitOrganizationGroupPolicyResult;
  getOrganizationPolicyHistoryResult =
    this.policies.getOrganizationPolicyHistoryResult;
  createOrganizationGroup = this.policies.createOrganizationGroup;
  createOrganizationGroupResult = this.policies.createOrganizationGroupResult;
  deleteOrganizationGroup = this.policies.deleteOrganizationGroup;
  deleteOrganizationGroupResult = this.policies.deleteOrganizationGroupResult;

  // Organizations: read model, roster, profile, and memberships.
  createOrganization = this.organizations.createOrganization;
  getOrganizationReadModelResult =
    this.organizations.getOrganizationReadModelResult;
  getOrganizationDataUsageResult =
    this.organizations.getOrganizationDataUsageResult;
  updateOrganizationRosterEntry =
    this.organizations.updateOrganizationRosterEntry;
  listOrganizationMemberships = this.organizations.listOrganizationMemberships;
  updateOrganizationMembership =
    this.organizations.updateOrganizationMembership;
  setOrganizationLeaveRequest = this.organizations.setOrganizationLeaveRequest;
  updateOrganizationProfile = this.organizations.updateOrganizationProfile;
  listOrganizationGroupMembers =
    this.organizations.listOrganizationGroupMembers;

  // Billing: native stores and Stripe.
  getOrganizationBilling = this.billing.getOrganizationBilling;
  getOrganizationBillingHistory = this.billing.getOrganizationBillingHistory;
  getOrganizationBillingManagementUrl =
    this.billing.getOrganizationBillingManagementUrl;
  getOrganizationNativePurchaseEligibility =
    this.billing.getOrganizationNativePurchaseEligibility;
  claimNativeOrganizationSubscription =
    this.billing.claimNativeOrganizationSubscription;
  getStripeCheckoutOptions = this.billing.getStripeCheckoutOptions;
  createStripeCheckout = this.billing.createStripeCheckout;
  createStripeCheckoutSession = this.billing.createStripeCheckoutSession;
  createStripePortal = this.billing.createStripePortal;
  cancelStripeSubscription = this.billing.cancelStripeSubscription;
  startOrganizationTrial = this.billing.startOrganizationTrial;

  // Root operator reads and suspensions.
  getRootOrganizationDataUsageResult =
    this.root.getRootOrganizationDataUsageResult;
  listRootAuditEventsResult = this.root.listRootAuditEventsResult;
  getRootOpsHealthReportResult = this.root.getRootOpsHealthReportResult;
  listRootRevenuecatEventsReportResult =
    this.root.listRootRevenuecatEventsReportResult;
  listRootDataUsageReportResult = this.root.listRootDataUsageReportResult;
  listRootOrganizationsResult = this.root.listRootOrganizationsResult;
  getRootOrganizationResult = this.root.getRootOrganizationResult;
  listRootOrganizationIdentitiesResult =
    this.root.listRootOrganizationIdentitiesResult;
  listRootOrganizationRevenuecatEventsResult =
    this.root.listRootOrganizationRevenuecatEventsResult;
  listRootIdentitiesResult = this.root.listRootIdentitiesResult;
  getRootIdentityResult = this.root.getRootIdentityResult;
  listRootIdentityOrganizationsResult =
    this.root.listRootIdentityOrganizationsResult;
  suspendRootIdentityResult = this.root.suspendRootIdentityResult;
  liftRootIdentitySuspensionResult = this.root.liftRootIdentitySuspensionResult;

  // Container writes: create, share, rotate, recite, delete.
  createContainer = this.containerWrites.createContainer;
  createContainerResult = this.containerWrites.createContainerResult;
  createContainerWithMetadataDocument =
    this.containerWrites.createContainerWithMetadataDocument;
  createContainerWithMetadataDocumentResult =
    this.containerWrites.createContainerWithMetadataDocumentResult;
  shareContainer = this.containerWrites.shareContainer;
  shareContainerResult = this.containerWrites.shareContainerResult;
  revokeContainer = this.containerWrites.revokeContainer;
  revokeContainerResult = this.containerWrites.revokeContainerResult;
  rekeyContainer = this.containerWrites.rekeyContainer;
  rekeyContainerResult = this.containerWrites.rekeyContainerResult;
  moveContainer = this.containerWrites.moveContainer;
  moveContainerResult = this.containerWrites.moveContainerResult;
  reciteContainer = this.containerWrites.reciteContainer;
  deleteContainer = this.containerWrites.deleteContainer;
  deleteContainerResult = this.containerWrites.deleteContainerResult;

  // Container reads: rotation log, replacement authorizations, lanes.
  getContainerReplacementAuthorizationsResult =
    this.containerReads.getContainerReplacementAuthorizationsResult;
  getContainerKekLog = this.containerReads.getContainerKekLog;
  listContainerParentLanes = this.containerReads.listContainerParentLanes;
  listContainerDocumentLanes = this.containerReads.listContainerDocumentLanes;

  // Documents: create, link set, purge, sync, and edit attribution.
  createDocument = this.documents.createDocument;
  createDocumentResult = this.documents.createDocumentResult;
  getDocumentEditAttribution = this.documents.getDocumentEditAttribution;
  listDocumentEditAttributionRanges =
    this.documents.listDocumentEditAttributionRanges;
  linkDocument = this.documents.linkDocument;
  linkDocumentResult = this.documents.linkDocumentResult;
  unlinkDocument = this.documents.unlinkDocument;
  unlinkDocumentResult = this.documents.unlinkDocumentResult;
  purgeDocument = this.documents.purgeDocument;
  getDocumentPurgeProof = this.documents.getDocumentPurgeProof;
  syncDocument = this.documents.syncDocument;
  syncDocumentResult = this.documents.syncDocumentResult;

  // Blobs and document attachments.
  initiateMultipartBlobStage = this.blobs.initiateMultipartBlobStage;
  getMultipartBlobStage = this.blobs.getMultipartBlobStage;
  uploadMultipartBlobPartBytes = this.blobs.uploadMultipartBlobPartBytes;
  getBlobBytes = this.blobs.getBlobBytes;
  bindBlobAttachment = this.blobs.bindBlobAttachment;
  detachBlobAttachment = this.blobs.detachBlobAttachment;
  listDocumentAttachments = this.blobs.listDocumentAttachments;

  // Writer projections and their cache invalidation.
  getContainerWriterProjection = this.projections.getContainerWriterProjection;
  getContainerWriterProjectionResult =
    this.projections.getContainerWriterProjectionResult;
  getDocumentWriterProjection = this.projections.getDocumentWriterProjection;
  getDocumentWriterProjectionResult =
    this.projections.getDocumentWriterProjectionResult;
  primeDocumentWriterProjection =
    this.projections.primeDocumentWriterProjection;
  primeContainerWriterProjection =
    this.projections.primeContainerWriterProjection;
  clearWriterProjectionCaches = this.context.clearWriterProjectionCaches;
  evictWriterProjectionsCiting = this.context.evictWriterProjectionsCiting;
  evictDocumentWriterProjection = this.context.evictDocumentWriterProjection;
  evictContainerWriterProjection = this.context.evictContainerWriterProjection;
}

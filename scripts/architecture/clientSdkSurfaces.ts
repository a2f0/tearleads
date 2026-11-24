import { packageSourcePath } from "./dependencySourceRoots";

// The files each client SDK subsystem lets other subsystems import; see
// `subsystem-imports-use-declared-surface` in subsystemSurfaces.ts.
const sdk = packageSourcePath.clientSdk;

// The workflows/principals modules the rest of the SDK may import. Its index
// is the public package facade, so recovery's verification context, history
// selection, and stored stage and prefix formats stay private to it.
const principalsWorkflowSurface = [
  "acknowledgements/acknowledgedPrincipalCurrents",
  "acknowledgements/acknowledgedPrincipalPredecessor",
  "acknowledgements/principalAcknowledgementChecks",
  "currentPrincipalPolicyReader",
  "externalAdminPolicy",
  "index",
  "historyRecovery/loadRecoveredPrincipalHistoryPage",
  "policyRepair",
  "policyRepairBudget",
  "recoveryOperation/principalCurrentRecoveryBatch",
  "principalPolicyHistoryReader",
  "principalPolicyService",
  "runtimePolicyRecovery",
].map((module) => `${sdk}/workflows/principals/${module}.ts`);

// The data/principals modules the rest of the SDK may import. Organization
// Read Models builds group policy, the group directory, membership, and
// journaled principal mutations on them, and registration builds the
// founding policies.
const principalsDataSurface = [
  "currentPolicyReferenceResolver",
  "organizationGroupDirectoryRequest",
  "organizationGroupRoles",
  "organizationPolicyRequest",
  "principalHistoryProtection",
  "principalHistoryScopeProtection",
  "principalKeyValidation",
  "principalMutationJournal",
  "principalMutationJournalRecord",
  "principalPolicyCoordinator",
  "principalPolicyCrypto",
  "principalPolicyRecipients",
  "principalPolicyRequest",
  "principalPolicyVerification",
].map((module) => `${sdk}/data/principals/${module}.ts`);

export const documentStoreClientSurface = [`${sdk}/client/documents/index.ts`];

// Every Principal Policy Contracts module is a contract: Keying Verification
// verifies policies with them, and Principal Policy builds on them.
export const principalPolicyContractsSurface = [
  ...[
    "organizationAuthorityDescriptor",
    "principalIdentityCommitments",
    "principalPolicyAdminSigners",
    "principalPolicyEvidence",
    "principalPolicyStates",
  ].map((module) => `${sdk}/data/principalContracts/${module}.ts`),
  `${sdk}/data/persistence/principalContracts/principalGrantRetirementPersistence.ts`,
];
// The document projection, container KEK path, reader, and sync contracts that
// Container Data, Client Blob Storage, and Document Store & Sync build on.
// Document sync also uses the KEK currency, content crypto, event, outgoing
// batch, pagination, decryption, import, verdict, Loro runtime-failure ledger,
// runtime health, Loro lifetime and read-window, content-key commitment,
// acknowledgement, and submit-failure contracts.
export const documentProjectionContractsSurface = [
  `${sdk}/data/documents/shared/containerKek/index.ts`,
  `${sdk}/data/documents/shared/projection/index.ts`,
  `${sdk}/data/documents/shared/containerKek/containerKekCurrency.ts`,
  `${sdk}/data/documents/shared/containerKek/containerKekPath.ts`,
  `${sdk}/data/documents/shared/contentRecordKeys.ts`,
  `${sdk}/data/documents/shared/crypto.ts`,
  `${sdk}/data/documents/shared/events.ts`,
  `${sdk}/data/documents/shared/projection/freshProjectionRetry.ts`,
  `${sdk}/data/documents/shared/projection/projectionVerificationOptions.ts`,
  `${sdk}/data/documents/shared/readers.ts`,
  `${sdk}/data/documents/shared/responses.ts`,
  `${sdk}/data/documents/shared/stableDocumentId.ts`,
  `${sdk}/data/documents/shared/sync/contentKeyCommitment.ts`,
  `${sdk}/data/documents/shared/sync/documentSyncImportVerdicts.ts`,
  `${sdk}/data/documents/shared/sync/documentSyncOutgoingBatch.ts`,
  `${sdk}/data/documents/shared/sync/documentSyncTypes.ts`,
  `${sdk}/data/documents/shared/sync/documentSyncUpdateDecryption.ts`,
  `${sdk}/data/documents/shared/sync/documentSyncUpdateImport.ts`,
  `${sdk}/data/documents/shared/sync/documentSyncUpdateIsolation.ts`,
  `${sdk}/data/documents/shared/sync/documentUpdateVerdict.ts`,
  `${sdk}/data/documents/shared/sync/loroLifetime.ts`,
  `${sdk}/data/documents/shared/sync/loroRuntimeFailureLedger.ts`,
  `${sdk}/data/documents/shared/sync/loroRuntimeHealth.ts`,
  `${sdk}/data/documents/shared/sync/loroRuntimeHealthMachine.ts`,
  `${sdk}/data/documents/shared/sync/loroWindowDrain.ts`,
  `${sdk}/data/documents/shared/sync/loroWindowDrainMachine.ts`,
  `${sdk}/data/documents/shared/sync/loroWindowGate.ts`,
  `${sdk}/data/documents/shared/sync/loroWindowMachine.ts`,
  `${sdk}/data/documents/shared/sync/mutationAcknowledgement.ts`,
  `${sdk}/data/documents/shared/sync/peerRebase.ts`,
  `${sdk}/data/documents/shared/sync/pullContinuation.ts`,
  `${sdk}/data/documents/shared/sync/rotationAvailabilityMachine.ts`,
  `${sdk}/data/documents/shared/sync/syncPagination.ts`,
  `${sdk}/data/documents/shared/sync/syncSubmitFailure.ts`,
  `${sdk}/data/documents/shared/types.ts`,
];

export const documentStoreSurface = [
  `${sdk}/data/documents/index.ts`,
  `${sdk}/data/persistence/documents/records/index.ts`,
  `${sdk}/stores/documents/index.ts`,
  `${sdk}/workflows/documents/index.ts`,
  `${sdk}/data/documents/documentConstants.ts`,
  `${sdk}/data/documents/documentKinds.ts`,
  `${sdk}/data/documents/documentSummary.ts`,
  `${sdk}/data/documents/documentSync.ts`,
  `${sdk}/data/documents/editAttribution.ts`,
  `${sdk}/data/persistence/documents/containerDocumentTombstoneHoldRepository.ts`,
  `${sdk}/data/persistence/documents/containerDocumentTombstoneHoldsPersistence.ts`,
  `${sdk}/data/persistence/documents/documentDiscoveryEvidencePersistence.ts`,
  `${sdk}/data/persistence/documents/documentPlacement.ts`,
  `${sdk}/data/persistence/documents/documentProjectionContainers.ts`,
  `${sdk}/data/persistence/documents/documentsPersistence.ts`,
  `${sdk}/data/persistence/documents/records/documentRowsInTransaction.ts`,
  `${sdk}/data/persistence/documents/records/documentPendingUpdatePersistence.ts`,
  `${sdk}/data/persistence/documents/records/documentSyncFailurePersistence.ts`,
  `${sdk}/stores/documents/documentStore/internalRelink.ts`,
  `${sdk}/stores/documents/documentStore/sync/remoteWork.ts`,
  `${sdk}/stores/documents/registry.ts`,
  `${sdk}/workflows/documents/persistence.ts`,
  `${sdk}/workflows/documents/purge/subtreePurgeScope.ts`,
  `${sdk}/workflows/documents/remoteReset/documentRemoteReset.ts`,
  `${sdk}/workflows/documents/sync/initialSync.ts`,
  `${sdk}/workflows/documents/sync/processedCursor.ts`,
  `${sdk}/workflows/documents/sync/reportDocumentSyncQuarantine.ts`,
  `${sdk}/workflows/documents/syncFailures/syncFailureClassification.ts`,
  `${sdk}/data/persistence/documents/types.ts`,
];

export const containerContentsClientSurface = [
  `${sdk}/client/containerContents/index.ts`,
  `${sdk}/client/containerContents/documentDiscovery.ts`,
];

export const containerContentsSurface = [
  `${sdk}/stores/container-contents/index.ts`,
  `${sdk}/workflows/container-contents/index.ts`,
  `${sdk}/workflows/container-contents/pendingWrites/index.ts`,
  `${sdk}/data/persistence/container-contents/containerContentsPersistence.ts`,
  `${sdk}/data/persistence/container-contents/containerPersistence.ts`,
  `${sdk}/data/persistence/container-contents/documentContainerProjectionPersistence.ts`,
  `${sdk}/stores/container-contents/types.ts`,
  `${sdk}/workflows/container-contents/documentDiscovery/containerDocumentListing.ts`,
  `${sdk}/workflows/container-contents/documentPriming/documentHydrationProbe.ts`,
  `${sdk}/workflows/container-contents/metadata/containerMetadataDocument.ts`,
  `${sdk}/workflows/container-contents/projectionView.ts`,
  `${sdk}/workflows/container-contents/recovery/accessRestoration.ts`,
  `${sdk}/workflows/container-contents/remoteHydration/destination/destinationRoleCache.ts`,
  `${sdk}/workflows/container-contents/remoteReset/containerRemoteReset.ts`,
  `${sdk}/workflows/container-contents/syncLane.ts`,
  `${sdk}/workflows/container-contents/attribution/attributionVoids.ts`,
  `${sdk}/workflows/container-contents/attribution/documentAttributionRanges.ts`,
  `${sdk}/workflows/container-contents/documentDiscovery/documentDiscoveryEvidence.ts`,
  `${sdk}/workflows/container-contents/documentDiscovery/documentDiscoveryLanes.ts`,
  `${sdk}/workflows/container-contents/documentDiscovery/documentDiscoveryTypes.ts`,
  `${sdk}/workflows/container-contents/documentQueries/documentStructure.ts`,
  `${sdk}/workflows/container-contents/documentQueries/index.ts`,
  `${sdk}/workflows/container-contents/info/blobInfo.ts`,
  `${sdk}/workflows/container-contents/info/containerInfo.ts`,
  `${sdk}/workflows/container-contents/info/documentInfo.ts`,
  `${sdk}/workflows/container-contents/projectionKeys.ts`,
  `${sdk}/workflows/container-contents/runtime.ts`,
  `${sdk}/workflows/container-contents/syncPause/discoveryGuard.ts`,
  `${sdk}/workflows/container-contents/syncState.ts`,
  `${sdk}/workflows/container-contents/tombstones/documentPurge.ts`,
  `${sdk}/workflows/container-contents/tombstones/documentTombstoneEvidence.ts`,
];

export const containerDataSurface = [
  `${sdk}/workflows/containers/index.ts`,
  `${sdk}/workflows/containers/rematerialization/index.ts`,
  `${sdk}/data/containers/shared/authorAccess.ts`,
  `${sdk}/data/containers/shared/containerPathLimits.ts`,
  `${sdk}/data/containers/shared/mutationAcknowledgement.ts`,
  `${sdk}/data/containers/shared/mutationFailures.ts`,
  `${sdk}/data/containers/shared/projection.ts`,
  `${sdk}/data/containers/shared/types.ts`,
  `${sdk}/workflows/containers/child/create/createSubmission.ts`,
  `${sdk}/workflows/containers/child/mutationSubmit.ts`,
];

export const blobStorageClientSurface = [`${sdk}/client/blobs/index.ts`];

export const blobStorageSurface = [
  `${sdk}/workflows/blobs/index.ts`,
  `${sdk}/workflows/blobs/upload/index.ts`,
  `${sdk}/data/blobs/blobContracts.ts`,
  `${sdk}/workflows/blobs/blobAttachmentService.ts`,
  `${sdk}/workflows/blobs/verification/attachmentDecryptor.ts`,
  `${sdk}/workflows/blobs/verification/attachmentKeyAuthenticator.ts`,
  `${sdk}/workflows/blobs/verification/retainedAttachmentVerification.ts`,
  `${sdk}/data/blobs/createBlobStore.ts`,
  `${sdk}/data/blobs/memoryBlobStore.ts`,
];

export const organizationClientSurface = [
  `${sdk}/client/organizations/index.ts`,
  `${sdk}/client/organizations/organizationReadModels.ts`,
  `${sdk}/client/organizations/recipientAdmission.ts`,
];

export const organizationReadModelSurface = [
  `${sdk}/workflows/organizations/groupShare/index.ts`,
  `${sdk}/workflows/organizations/index.ts`,
  `${sdk}/workflows/organizations/principalPolicy/index.ts`,
  `${sdk}/workflows/organizations/readModel/index.ts`,
  `${sdk}/data/persistence/organizations/organizationProvisioningAttemptRepository.ts`,
  `${sdk}/workflows/organizations/containerContentsHost.ts`,
  `${sdk}/workflows/organizations/groupPolicy/groupPolicyMutationHead.ts`,
  `${sdk}/workflows/organizations/organizationProfile.ts`,
  `${sdk}/workflows/organizations/principalMutations/principalMutationJournalManagement.ts`,
  `${sdk}/workflows/organizations/readModel/organizationRemoteReset.ts`,
  `${sdk}/workflows/organizations/rosterProfileContainer.ts`,
  `${sdk}/data/persistence/organizations/organizationReadModelRepository.ts`,
  `${sdk}/workflows/organizations/currentOrganizationAuthority.ts`,
  `${sdk}/workflows/organizations/groupMetadata/currentGroupMetadataAuthority.ts`,
  `${sdk}/workflows/organizations/groupMetadata/groupMetadataRuntime.ts`,
  `${sdk}/workflows/organizations/groupNames/groupMembershipName.ts`,
  `${sdk}/workflows/organizations/groupNames/organizationGroupNames.ts`,
  `${sdk}/workflows/organizations/groupPolicy/commitCurrentGroupPolicyMutation.ts`,
  `${sdk}/workflows/organizations/groupPolicy/groupPolicyRequests.ts`,
  `${sdk}/workflows/organizations/groups/createCurrentOrganizationGroup.ts`,
  `${sdk}/workflows/organizations/groups/deleteCurrentOrganizationGroup.ts`,
  `${sdk}/workflows/organizations/memberships/leaveRequestMembersEvidence.ts`,
  `${sdk}/workflows/organizations/memberships/leaveRequestVerification.ts`,
  `${sdk}/workflows/organizations/memberships/rosterVouchedAdmission.ts`,
  `${sdk}/workflows/organizations/policyHistory/groupPolicyHistoryPage.ts`,
  `${sdk}/workflows/organizations/policyHistory/loadPolicyHistoryDetails.ts`,
  `${sdk}/workflows/organizations/principalMutations/runtimeCurrentGroupMutation.ts`,
  `${sdk}/workflows/organizations/principalMutations/runtimeCurrentOrganizationMutation.ts`,
  `${sdk}/workflows/organizations/readModel/organizationPresentationAccessState.ts`,
  `${sdk}/workflows/organizations/trustedOrganizationUsers.ts`,
];

export const rootConsoleSurface = [
  `${sdk}/client/root/index.ts`,
  `${sdk}/workflows/root/index.ts`,
];

export const principalPolicySurface = [
  ...principalsWorkflowSurface,
  `${sdk}/data/persistence/principalCurrentAcknowledgementPersistence.ts`,
  `${sdk}/data/persistence/principalMutationJournalPersistence.ts`,
  `${sdk}/data/persistence/principalPolicy/heldOrganizationDirectories.ts`,
  `${sdk}/data/persistence/principalPolicy/principalPolicyBundleRepository.ts`,
  `${sdk}/data/persistence/principalPolicy/principalPolicyPersistence.ts`,
  `${sdk}/data/persistence/principalPolicy/principalPolicyRemoteReset.ts`,
  `${sdk}/data/persistence/principalPolicy/verifiedPrincipalPolicyCurrent.ts`,
  ...principalsDataSurface,
];

export const registrationSurface = [
  `${sdk}/workflows/registration/index.ts`,
  `${sdk}/workflows/registration/organizationProvisioning.ts`,
  `${sdk}/workflows/registration/provisionedStatePrimer.ts`,
];

export const deviceFirstClientSurface = [`${sdk}/client/deviceFirst/index.ts`];

export const syncEngineSurface = [
  `${sdk}/stores/local-projection/index.ts`,
  `${sdk}/sync/reconciliation/index.ts`,
  `${sdk}/workflows/sync/index.ts`,
];

export const syncCoordinationSurface = [
  `${sdk}/workflows/sync/coordination.ts`,
  `${sdk}/data/shared/domainScope.ts`,
  `${sdk}/data/sync/crdtPeerSeed.ts`,
  `${sdk}/data/sync/downloadHistory.ts`,
  `${sdk}/data/sync/organizationSyncPauses.ts`,
  `${sdk}/data/sync/originatedDocuments.ts`,
  `${sdk}/data/sync/outgoingUpdateSettlement.ts`,
  `${sdk}/data/sync/sequence.ts`,
  `${sdk}/data/sync/syncCoordinator.ts`,
  `${sdk}/data/sync/syncLaneConfig.ts`,
];

export const identitySurface = [`${sdk}/data/trustedUserIdentity/index.ts`];

export const identitySessionClientSurface = [
  `${sdk}/client/identity/index.ts`,
  `${sdk}/client/session/index.ts`,
  `${sdk}/client/identity/keyPackage.ts`,
  `${sdk}/client/identity/userIdentities.ts`,
  `${sdk}/client/session/sessionRecoveryErrors.ts`,
  `${sdk}/client/session/sessionRootAuthority.ts`,
  `${sdk}/client/session/sessionTypes.ts`,
];

export const localKeyringSurface = [
  `${sdk}/client/localKeyring/index.ts`,
  `${sdk}/client/localKeyring/localKeyringPinCode.ts`,
];

export const purchasesSurface = [
  `${sdk}/client/billing/directCheckout.ts`,
  `${sdk}/client/billing/purchases.ts`,
];

export const keyingVerificationSurface = [
  `${sdk}/data/keyingProjectionVerification/index.ts`,
  `${sdk}/data/keying/`,
  `${sdk}/data/keyingProjectionVerification/checkpoints/heldContainerHeads.ts`,
  `${sdk}/data/keyingProjectionVerification/document/documentContainerProjections.ts`,
  `${sdk}/data/keyingProjectionVerification/error.ts`,
  `${sdk}/data/keyingProjectionVerification/principalPolicy/principalPolicyCache.ts`,
  `${sdk}/data/keyingProjectionVerification/readers.ts`,
  `${sdk}/data/keyingProjectionVerification/types.ts`,
  `${sdk}/data/keyingProjectionVerification/userKeyResolver.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/documentPurgeCheckpointPersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/keyingCheckpointAdvancePersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/keyingCheckpointPersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/keyingCheckpointRepository.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/organizationReplacementCheckpointPersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/principalPolicyOrganizationPersistence.ts`,
  `${sdk}/data/persistence/organizationFounderPersistence.ts`,
  `${sdk}/data/persistence/verifiedManifestBundlePersistence.ts`,
];

export const securityIncidentClientSurface = [
  `${sdk}/client/securityIncidents/index.ts`,
];

export const securityIncidentSurface = [
  `${sdk}/data/shared/securityIncidents.ts`,
  `${sdk}/data/persistence/securityIncidentPersistence.ts`,
];

export const runtimeRootSurface = [
  `${sdk}/client/index.ts`,
  `${sdk}/Tearleads.ts`,
  `${sdk}/TearleadsOptions.ts`,
  `${sdk}/client/host/`,
  `${sdk}/client/runtime/database.ts`,
  `${sdk}/client/runtime/workflowRuntime.ts`,
  `${sdk}/index.ts`,
];

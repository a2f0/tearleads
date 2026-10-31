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
  "policyVerification",
  "recoveryOperation/principalCurrentRecoveryBatch",
  "principalPolicyHistoryReader",
  "runtimePolicyRecovery",
  "runtimePolicyWarmer",
  "runtimeProjectionPolicyRecovery",
].map((module) => `${sdk}/workflows/principals/${module}.ts`);

// The data/principals modules the rest of the SDK may import. Organization
// Read Models builds group policy, membership, and journaled principal
// mutations on them.
const principalsDataSurface = [
  "currentPolicyReferenceResolver",
  "organizationAuthorityDescriptor",
  "organizationGroupRoles",
  "principalHistoryProtection",
  "principalHistoryRuntime",
  "principalHistoryScopeProtection",
  "principalKeyValidation",
  "principalMutationJournal",
  "principalMutationJournalRecord",
  "principalPolicyAdminSigners",
  "principalPolicyCoordinator",
  "principalPolicyCrypto",
  "principalPolicyEvidence",
  "principalPolicyStates",
].map((module) => `${sdk}/data/principals/${module}.ts`);

export const documentStoreSurface = [
  `${sdk}/client/documents/index.ts`,
  `${sdk}/data/documents/index.ts`,
  `${sdk}/data/documents/shared/containerKek/index.ts`,
  `${sdk}/data/documents/shared/projection/index.ts`,
  `${sdk}/data/persistence/documents/records/index.ts`,
  `${sdk}/stores/documents/index.ts`,
  `${sdk}/workflows/documents/index.ts`,
  `${sdk}/data/documents/attachmentContentIdentity.ts`,
  `${sdk}/data/documents/documentConstants.ts`,
  `${sdk}/data/documents/documentKinds.ts`,
  `${sdk}/data/documents/documentSummary.ts`,
  `${sdk}/data/documents/documentSync.ts`,
  `${sdk}/data/documents/editAttribution.ts`,
  `${sdk}/data/documents/shared/contentRecordKeys.ts`,
  `${sdk}/data/documents/shared/readers.ts`,
  `${sdk}/data/documents/shared/responses.ts`,
  `${sdk}/data/documents/shared/stableDocumentId.ts`,
  `${sdk}/data/documents/shared/sync/documentSyncUpdateIsolation.ts`,
  `${sdk}/data/documents/shared/sync/pullContinuation.ts`,
  `${sdk}/data/documents/shared/types.ts`,
  `${sdk}/data/persistence/documents/containerDocumentTombstoneHoldsPersistence.ts`,
  `${sdk}/data/persistence/documents/documentDiscoveryEvidencePersistence.ts`,
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
  `${sdk}/workflows/documents/sync/reportDocumentSyncQuarantine.ts`,
  `${sdk}/workflows/documents/syncFailures/syncFailureClassification.ts`,
];

export const containerContentsSurface = [
  `${sdk}/client/containerContents/index.ts`,
  `${sdk}/stores/container-contents/index.ts`,
  `${sdk}/workflows/container-contents/index.ts`,
  `${sdk}/client/containerContents/documentDiscovery.ts`,
  `${sdk}/data/persistence/container-contents/containerContentsPersistence.ts`,
  `${sdk}/data/persistence/container-contents/containerPersistence.ts`,
  `${sdk}/data/persistence/container-contents/documentContainerProjectionPersistence.ts`,
  `${sdk}/data/persistence/container-contents/documentPlacement.ts`,
  `${sdk}/data/persistence/container-contents/pendingContainerCreate.ts`,
  `${sdk}/stores/container-contents/types.ts`,
  `${sdk}/workflows/container-contents/documentDiscovery/containerDocumentListing.ts`,
  `${sdk}/workflows/container-contents/documentPriming/documentHydrationProbe.ts`,
  `${sdk}/workflows/container-contents/metadata/containerMetadataDocument.ts`,
  `${sdk}/workflows/container-contents/projectionView.ts`,
  `${sdk}/workflows/container-contents/recovery/accessRestoration.ts`,
  `${sdk}/workflows/container-contents/remoteReset/containerRemoteReset.ts`,
  `${sdk}/workflows/container-contents/syncLane.ts`,
];

export const containerDataSurface = [
  `${sdk}/workflows/containers/index.ts`,
  `${sdk}/workflows/containers/rematerialization/index.ts`,
  `${sdk}/data/containers/shared/authorAccess.ts`,
  `${sdk}/data/containers/shared/containerPathLimits.ts`,
  `${sdk}/data/containers/shared/heldContainerHeads.ts`,
  `${sdk}/data/containers/shared/mutationAcknowledgement.ts`,
  `${sdk}/data/containers/shared/mutationFailures.ts`,
  `${sdk}/data/containers/shared/projection.ts`,
  `${sdk}/data/containers/shared/types.ts`,
  `${sdk}/workflows/containers/child/create/createSubmission.ts`,
  `${sdk}/workflows/containers/child/mutationSubmit.ts`,
];

export const blobStorageSurface = [
  `${sdk}/client/blobs/index.ts`,
  `${sdk}/workflows/blobs/index.ts`,
  `${sdk}/workflows/blobs/upload/index.ts`,
  `${sdk}/data/blobs/blobContracts.ts`,
  `${sdk}/workflows/blobs/detach.ts`,
  `${sdk}/workflows/blobs/verification/attachmentDecryptor.ts`,
  `${sdk}/workflows/blobs/verification/attachmentKeyAuthenticator.ts`,
  `${sdk}/workflows/blobs/verification/retainedAttachmentVerification.ts`,
];

export const organizationReadModelSurface = [
  `${sdk}/client/organizations/index.ts`,
  `${sdk}/workflows/organizations/groupShare/index.ts`,
  `${sdk}/workflows/organizations/index.ts`,
  `${sdk}/workflows/organizations/principalPolicy/index.ts`,
  `${sdk}/workflows/organizations/readModel/index.ts`,
  `${sdk}/client/organizations/organizationReadModels.ts`,
  `${sdk}/workflows/organizations/groupMetadata/groupMetadataErrors.ts`,
  `${sdk}/workflows/organizations/groupMetadata/groupMetadataRuntime.ts`,
  `${sdk}/workflows/organizations/groupMetadata/runtimeGroupMetadataAuthority.ts`,
  `${sdk}/workflows/organizations/groupPolicy/groupPolicyMutationHead.ts`,
  `${sdk}/workflows/organizations/organizationProfile.ts`,
  `${sdk}/workflows/organizations/principalMutations/principalMutationJournalManagement.ts`,
  `${sdk}/workflows/organizations/provisioning/createOrganization.ts`,
  `${sdk}/workflows/organizations/provisioning/organizationProvisioningAttempt.ts`,
  `${sdk}/workflows/organizations/provisioning/organizationReplacementVerification.ts`,
  `${sdk}/workflows/organizations/readModel/organizationRemoteReset.ts`,
  `${sdk}/workflows/organizations/rosterProfileContainer.ts`,
];

export const rootConsoleSurface = [
  `${sdk}/client/root/index.ts`,
  `${sdk}/workflows/root/index.ts`,
];

export const principalPolicySurface = [
  ...principalsWorkflowSurface,
  `${sdk}/data/persistence/principalCurrentAcknowledgementPersistence.ts`,
  `${sdk}/data/persistence/principalKeys/principalGrantRetirementPersistence.ts`,
  `${sdk}/data/persistence/principalMutationJournalPersistence.ts`,
  `${sdk}/data/persistence/principalPolicy/locallyAcknowledgedPrincipalPolicyPersistence.ts`,
  `${sdk}/data/persistence/principalPolicy/principalPolicyPersistence.ts`,
  `${sdk}/data/persistence/principalPolicy/principalPolicyRemoteReset.ts`,
  `${sdk}/data/persistence/principalPolicy/principalPolicyReferencePersistence.ts`,
  `${sdk}/data/persistence/principalPolicy/verifiedPrincipalPolicyBundlePersistence.ts`,
  `${sdk}/data/persistence/principalPolicy/verifiedPrincipalPolicyCurrent.ts`,
  `${sdk}/data/persistence/principalPolicy/verifiedPrincipalPolicyRetentionPersistence.ts`,
  ...principalsDataSurface,
];

export const registrationSurface = [
  `${sdk}/workflows/registration/index.ts`,
  `${sdk}/workflows/registration/organizationProvisioning.ts`,
  `${sdk}/workflows/registration/provisionedPrincipalHistory.ts`,
];

export const syncEngineSurface = [
  `${sdk}/client/deviceFirst/index.ts`,
  `${sdk}/stores/local-projection/index.ts`,
  `${sdk}/sync/reconciliation/index.ts`,
  `${sdk}/workflows/sync/index.ts`,
  `${sdk}/data/shared/domainScope.ts`,
  `${sdk}/data/sync/crdtPeerSeed.ts`,
  `${sdk}/data/sync/databaseUnavailable.ts`,
  `${sdk}/data/sync/organizationSyncPauses.ts`,
  `${sdk}/data/sync/outgoingUpdateSettlement.ts`,
  `${sdk}/data/sync/sequence.ts`,
  `${sdk}/data/sync/syncCoordinator.ts`,
];

export const identitySurface = [
  `${sdk}/client/identity/index.ts`,
  `${sdk}/client/session/index.ts`,
  `${sdk}/data/trustedUserIdentity/index.ts`,
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
  `${sdk}/data/keyingProjectionVerification/dependencyUnavailable.ts`,
  `${sdk}/data/keyingProjectionVerification/document/documentContainerProjections.ts`,
  `${sdk}/data/keyingProjectionVerification/error.ts`,
  `${sdk}/data/keyingProjectionVerification/principalPolicy/principalPolicyCache.ts`,
  `${sdk}/data/keyingProjectionVerification/readers.ts`,
  `${sdk}/data/keyingProjectionVerification/types.ts`,
  `${sdk}/data/keyingProjectionVerification/userKeyResolver.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/documentPurgeCheckpointPersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/keyingCheckpointAdvancePersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/keyingCheckpointPersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/organizationReplacementCheckpointPersistence.ts`,
  `${sdk}/data/persistence/keyingCheckpoints/principalPolicyOrganizationPersistence.ts`,
  `${sdk}/data/persistence/organizationFounderPersistence.ts`,
  `${sdk}/data/persistence/verifiedManifestBundlePersistence.ts`,
];

export const securityIncidentSurface = [
  `${sdk}/client/securityIncidents/index.ts`,
  `${sdk}/data/shared/securityIncidents.ts`,
];

export const runtimeRootSurface = [
  `${sdk}/client/index.ts`,
  `${sdk}/Tearleads.ts`,
  `${sdk}/TearleadsOptions.ts`,
  `${sdk}/client/host/`,
  `${sdk}/client/runtime/database.ts`,
  `${sdk}/client/runtime/listenerSet.ts`,
  `${sdk}/client/runtime/workflowRuntime.ts`,
  `${sdk}/index.ts`,
];

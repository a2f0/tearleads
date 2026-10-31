// The SQLite tables each client SDK subsystem owns, by the name of their
// `sqliteTable` export, and the ones it lets other subsystems read. Only the
// owner writes a table; see `subsystem-uses-own-tables` in subsystemTables.ts.

export const documentStoreTables = [
  "containerDocumentTombstoneHolds",
  "documentAttachmentBlobProjection",
  "documentDiscoveryHeads",
  "documentDiscoverySequence",
  "documentHistoryCheckpoints",
  "documentHistoryUpdates",
  "documentOrphanBlobReclaims",
  "documentPendingAttachments",
  "documentProjection",
  "documentProjectionText",
  "documents",
  "pendingDocumentDiscoveries",
];

export const containerContentsTables = [
  "containerHydrationTombstones",
  "containerSyncWatermarks",
  "containers",
  "documentContainerProjection",
  "documentIntentLinkTargets",
  "dormantContainerMetadata",
  "dormantMetadataSweepRequests",
  "localIntents",
  "supersededContainerBindings",
];

export const organizationReadModelTables = [
  "organizationDataUsageSnapshots",
  "organizationPresentationDenials",
  "organizationProvisioningAttempts",
  "organizationReadModelContainerGrants",
  "organizationReadModelDirectoryUsers",
  "organizationReadModelGroupMembers",
  "organizationReadModelGroups",
  "organizationReadModelRequesters",
  "organizationReadModelState",
];

export const principalPolicyTables = [
  "principalGrantRetirements",
  "principalHistoryEntries",
  "principalHistoryNodes",
  "principalHistoryPrefixes",
  "principalHistoryRootOwners",
  "principalHistoryStages",
  "principalKeyEnvelopeArchive",
  "principalMutationJournal",
  "principalPolicies",
  "principalPolicyBundleHistory",
  "principalPolicyBundleReferences",
];

export const identityTables = ["trustedUserIdentityPins"];

export const syncEngineTables = [
  "organizationSyncPauseRemovals",
  "organizationSyncPauses",
];

export const keyingVerificationTables = [
  "accessManifestCheckpoints",
  "documentPurgeCheckpoints",
  "organizationFounders",
  "principalPolicyCheckpoints",
  "verifiedAccessManifestBundles",
];

export const securityIncidentTables = ["securityIncidents"];

// Container Contents is a read model over documents and their placements; its
// listing, pending-write, and priming queries join the document tables, and it
// loads each folder's metadata document from its history checkpoint. Keying
// reads discovery evidence to choose which verified bundles a request cites.
export const documentStoreReadableTables = [
  "containerDocumentTombstoneHolds",
  "documentAttachmentBlobProjection",
  "documentDiscoveryHeads",
  "documentHistoryCheckpoints",
  "documentHistoryUpdates",
  "documentPendingAttachments",
  "documentProjection",
  "documents",
  "pendingDocumentDiscoveries",
];

// The folder tree, document placements, and queued intents: Document Store
// reads them to delete and report on documents, and Keying to walk a folder's
// lineage when choosing which verified bundles to cite.
export const containerContentsReadableTables = [
  "containers",
  "documentContainerProjection",
  "localIntents",
];

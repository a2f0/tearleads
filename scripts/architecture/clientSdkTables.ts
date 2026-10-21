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
  "principalHistoryNodeReferences",
  "principalHistoryNodes",
  "principalHistoryPrefixes",
  "principalHistoryRootOwners",
  "principalHistoryStages",
  "principalKeyEnvelopeArchive",
  "principalMutationJournal",
  "principalPolicies",
  "principalPolicyBundleHistory",
  "principalPolicyBundleReferences",
  "principalPolicyOrganizations",
];

export const identityTables = ["trustedUserIdentityPins"];

export const keyingVerificationTables = [
  "accessManifestCheckpoints",
  "documentPurgeCheckpoints",
  "organizationFounders",
  "principalPolicyCheckpoints",
  "verifiedAccessManifestBundles",
];

export const securityIncidentTables = ["securityIncidents"];

// Container Contents is a read model over documents and their placements; its
// listing, pending-write, and priming queries join these tables.
export const documentStoreReadableTables = [
  "containerDocumentTombstoneHolds",
  "documentAttachmentBlobProjection",
  "documentHistoryUpdates",
  "documentPendingAttachments",
  "documentProjection",
  "documents",
];

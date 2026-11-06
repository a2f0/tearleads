import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";
import { containerDocumentTombstoneHolds } from "./containerDocumentTombstoneHoldSchema";
import {
  containerSQLiteSchema,
  containerTableSchemas,
} from "./containerSchema";
import {
  containerSyncWatermarks,
  containerSyncWatermarkTables,
} from "./containerSyncWatermarkSchema";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "./documentAttachmentSchema";
import { documentOrphanBlobReclaims } from "./documentOrphanBlobReclaimSchema";
import { documentIntentLinkTargets } from "./documentPlacementIntentSchema";
import {
  documentContainerProjection,
  documentContainerProjectionTables,
  documentProjection,
  documentProjectionTables,
} from "./documentProjectionSchema";
import { documents, documentTables } from "./documentRecordSchema";
import {
  accessManifestCheckpoints,
  documentPurgeCheckpoints,
  keyingCheckpointTables,
} from "./keyingCheckpointSchema";
import { localIntents } from "./localIntentSchema";
import * as organizationDataUsage from "./organizationDataUsageSchema";
import { organizationFounders } from "./organizationFounderSchema";
import * as provisioningAttempt from "./organizationProvisioningAttemptSchema";
import {
  organizationReadModelSQLiteSchema,
  organizationReadModelTables,
} from "./organizationReadModelTableRegistry";
import * as organizationSyncPause from "./organizationSyncPauseSchema";
import { principalGrantRetirements } from "./principalGrantRetirementSchema";
import {
  principalHistoryEntries,
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "./principalHistoryEvidenceSchema";
import { principalHistoryRootOwners } from "./principalHistoryNodeRetentionSchema";
import { principalKeyEnvelopeArchive } from "./principalHistoryRetentionSchema";
import { principalHistoryStages } from "./principalHistoryStageSchema";
import {
  principalMutationJournal,
  principalMutationJournalTables,
} from "./principalMutationJournalSchema";
import {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
  principalPolicyCheckpointTable,
  principalPolicyTables,
} from "./principalPolicySchema";
import {
  securityIncidents,
  securityIncidentTable,
} from "./securityIncidentSchema";
import {
  trustedUserIdentityPins,
  trustedUserIdentityPinTables,
} from "./trustedUserIdentityPinSchema";
import {
  verifiedAccessManifestBundles,
  verifiedManifestBundleTables,
} from "./verifiedManifestBundleSchema";

export {
  containerHydrationTombstones,
  containers,
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
  supersededContainerBindings,
} from "./containerSchema";
export {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "./documentAttachmentSchema";
export {
  inContainerIntentLanes,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  LOCAL_INTENT_SUBJECT,
  localIntents,
} from "./localIntentSchema";
export {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
} from "./principalPolicySchema";
export { securityIncidents } from "./securityIncidentSchema";
export { containerDocumentTombstoneHolds, organizationReadModelTables };

const securityIncidentTables: ReadonlyArray<SqlTableSchema> = [
  securityIncidentTable,
];

export const containerTables = containerTableSchemas;

export const localIntentTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(localIntents),
];

export const documentPlacementIntentTables: ReadonlyArray<SqlTableSchema> = [
  ...localIntentTables,
  defineSqlTableSchema(documentIntentLinkTargets),
];

export const clientSqlTables: ReadonlyArray<SqlTableSchema> = [
  ...principalMutationJournalTables,
  ...documentTables,
  ...principalPolicyTables,
  ...keyingCheckpointTables.filter((t) => t !== principalPolicyCheckpointTable),
  ...verifiedManifestBundleTables,
  ...trustedUserIdentityPinTables,
  ...securityIncidentTables,
  ...containerTables,
  ...documentContainerProjectionTables,
  ...documentPlacementIntentTables,
  ...documentProjectionTables,
  ...containerSyncWatermarkTables,
  ...organizationReadModelTables,
  ...organizationDataUsage.organizationDataUsageTables,
  ...provisioningAttempt.organizationProvisioningAttemptTables,
  ...organizationSyncPause.organizationSyncPauseTables,
];

export const clientSQLiteSchema = {
  principalHistoryRootOwners,
  principalKeyEnvelopeArchive,
  principalMutationJournal,
  principalHistoryEntries,
  principalHistoryNodes,
  principalHistoryPrefixes,
  principalHistoryStages,
  organizationFounders,
  principalGrantRetirements,
  documents,
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  accessManifestCheckpoints,
  documentPurgeCheckpoints,
  principalPolicyCheckpoints,
  verifiedAccessManifestBundles,
  trustedUserIdentityPins,
  securityIncidents,
  ...containerSQLiteSchema,
  documentContainerProjection,
  localIntents,
  documentIntentLinkTargets,
  documentProjection,
  documentPendingAttachments,
  documentAttachmentBlobProjection,
  documentOrphanBlobReclaims: documentOrphanBlobReclaims,
  containerSyncWatermarks,
  ...organizationReadModelSQLiteSchema,
  ...organizationDataUsage.organizationDataUsageSQLiteSchema,
  ...provisioningAttempt.organizationProvisioningAttemptSQLiteSchema,
  ...organizationSyncPause.organizationSyncPauseSQLiteSchema,
};

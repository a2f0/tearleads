export {
  buildVfsAclKeyView,
  type VfsAclKeyViewEntry,
  type VfsAclSnapshotEntry
} from './access/acl-key-view.js';
export {
  type EffectiveVfsAclKeyViewEntry,
  type EffectiveVfsMemberItemAccessEntry,
  InMemoryVfsAccessHarness,
  type VfsAuthoritativeMembershipSnapshot,
  type VfsAuthoritativePrincipalCatalogSnapshot,
  type VfsMemberPrincipalView
} from './access/sync-access-harness.js';
export {
  type AbandonVfsBlobInput,
  type AttachVfsBlobInput,
  InMemoryVfsBlobCommitStore,
  type StageVfsBlobInput,
  type VfsBlobCommitResult,
  type VfsBlobCommitStatus,
  type VfsBlobStageRecord,
  type VfsBlobStageStatus
} from './blob/sync-blob-commit.js';
export {
  type AttachVfsBlobWithIsolationInput,
  InMemoryVfsBlobIsolationStore,
  type VfsBlobIsolationAttachResult,
  type VfsBlobIsolationAttachStatus
} from './blob/sync-blob-isolation.js';
export {
  alwaysAvailableVfsBlobObjectStore,
  InMemoryVfsBlobObjectStore,
  type VfsBlobObjectStore
} from './blob/sync-blob-object-store.js';
export {
  delayVfsCrdtSyncTransport,
  type InMemoryVfsCrdtSyncTransportDelayConfig,
  type QueueVfsCrdtLocalOperationInput,
  VfsBackgroundSyncClient,
  type VfsBackgroundSyncClientFlushResult,
  type VfsBackgroundSyncClientOptions,
  type VfsBackgroundSyncClientPersistedState,
  type VfsBackgroundSyncClientSnapshot,
  type VfsBackgroundSyncClientSyncResult,
  type VfsCrdtSyncPullResponse,
  VfsCrdtSyncPushRejectedError,
  type VfsCrdtSyncPushResponse,
  type VfsCrdtSyncPushResult,
  type VfsCrdtSyncPushStatus,
  type VfsCrdtSyncReconcileResponse,
  type VfsCrdtSyncTransport,
  type VfsSyncGuardrailViolation,
  type VfsSyncGuardrailViolationCode
} from './client/sync-client.js';
export {
  InMemoryVfsCrdtSyncServer,
  type InMemoryVfsCrdtSyncServerSnapshot,
  InMemoryVfsCrdtSyncTransport
} from './client/sync-client-harness.js';
export {
  toGuardrailMetricEvent,
  toRematerializationMetricEvent,
  type VfsSyncGuardrailMetricEvent,
  type VfsSyncRematerializationMetricEvent
} from './client/syncClientTelemetry.js';
export {
  InMemoryVfsContainerClockStore,
  type ListVfsContainerClockChangesResult,
  type VfsContainerClockEntry
} from './protocol/sync-container-clocks.js';
export {
  assertCanonicalVfsCrdtOperationOrder,
  InMemoryVfsCrdtStateStore,
  reconcileCanonicalVfsCrdtOperations,
  reconcileVfsCrdtOperations,
  type VfsCrdtAclEntry,
  type VfsCrdtApplyResult,
  type VfsCrdtApplyStatus,
  type VfsCrdtLinkEntry,
  type VfsCrdtOperation,
  type VfsCrdtOpType,
  type VfsCrdtOrderViolationCode,
  VfsCrdtOrderViolationError,
  type VfsCrdtSnapshot
} from './protocol/sync-crdt.js';
export {
  assertStronglyConsistentVfsCrdtRows,
  type BuildVfsCrdtSyncQueryInput,
  buildVfsCrdtSyncQuery,
  mapVfsCrdtSyncRows,
  type ParsedVfsCrdtSyncQuery,
  type ParseVfsCrdtSyncQueryInput,
  type ParseVfsCrdtSyncQueryResult,
  parseVfsCrdtSyncQuery,
  type VfsCrdtFeedOrderViolationCode,
  VfsCrdtFeedOrderViolationError,
  type VfsCrdtSyncDbQuery,
  type VfsCrdtSyncDbRow,
  type VfsCrdtSyncItem,
  type VfsCrdtSyncResponse
} from './protocol/sync-crdt-feed.js';
export {
  InMemoryVfsCrdtFeedReplayStore,
  VfsCrdtFeedReplayError,
  type VfsCrdtFeedReplaySnapshot,
  type VfsCrdtFeedReplayViolationCode
} from './protocol/sync-crdt-feed-replay.js';
export {
  InMemoryVfsCrdtClientStateStore,
  mergeVfsCrdtLastReconciledWriteIds,
  type ParsedVfsCrdtReconcilePayload,
  type ParseVfsCrdtLastReconciledWriteIdsResult,
  type ParseVfsCrdtReconcilePayloadResult,
  parseVfsCrdtLastReconciledWriteIds,
  parseVfsCrdtReconcilePayload,
  type ReconcileVfsCrdtClientStateResult,
  reconcileVfsCrdtClientState,
  type VfsCrdtClientReconcileState,
  type VfsCrdtLastReconciledWriteIds
} from './protocol/sync-crdt-reconcile.js';
export {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  type VfsSyncCursor
} from './protocol/sync-cursor.js';
export {
  compareVfsSyncCursorOrder,
  InMemoryVfsSyncClientStateStore,
  type ParsedVfsSyncReconcilePayload,
  type ParseVfsSyncReconcilePayloadResult,
  parseVfsSyncReconcilePayload,
  type ReconcileVfsSyncCursorResult,
  reconcileVfsSyncCursor
} from './protocol/sync-reconcile.js';
export {
  assertStronglyConsistentVfsSyncRows,
  type BuildVfsSyncQueryInput,
  buildVfsSyncQuery,
  mapVfsSyncRows,
  type ParsedVfsSyncQuery,
  type ParseVfsSyncQueryInput,
  type ParseVfsSyncQueryResult,
  parseVfsSyncQuery,
  type VfsSyncDbQuery,
  type VfsSyncDbRow,
  type VfsSyncOrderViolationCode,
  VfsSyncOrderViolationError
} from './server/sync-engine.js';
export {
  deriveVfsFlatteningInventory,
  extractPostgresTableNamesFromDrizzleSchema,
  extractSqlTableReferences,
  isSqlReferenceSubsetOfFlattenedContract,
  VFS_SYNC_FLATTENED_TARGET_TABLES,
  VFS_SYNC_SCHEMA_DEPENDENCIES,
  type VfsFlatteningInventory,
  type VfsSyncSchemaDependency,
  type VfsSyncSchemaDomain
} from './server/sync-schema-contract.js';
export {
  VfsHttpCrdtSyncTransport,
  type VfsHttpCrdtSyncTransportOptions
} from './transport/sync-http-transport.js';

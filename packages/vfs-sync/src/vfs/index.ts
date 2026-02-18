export {
  buildVfsAclKeyView,
  type VfsAclKeyViewEntry,
  type VfsAclSnapshotEntry
} from './acl-key-view.js';
export {
  type EffectiveVfsAclKeyViewEntry,
  type EffectiveVfsMemberItemAccessEntry,
  InMemoryVfsAccessHarness,
  type VfsAuthoritativeMembershipSnapshot,
  type VfsAuthoritativePrincipalCatalogSnapshot,
  type VfsMemberPrincipalView
} from './sync-access-harness.js';
export {
  type AbandonVfsBlobInput,
  type AttachVfsBlobInput,
  InMemoryVfsBlobCommitStore,
  type StageVfsBlobInput,
  type VfsBlobCommitResult,
  type VfsBlobCommitStatus,
  type VfsBlobStageRecord,
  type VfsBlobStageStatus
} from './sync-blob-commit.js';
export {
  type AttachVfsBlobWithIsolationInput,
  InMemoryVfsBlobIsolationStore,
  type VfsBlobIsolationAttachResult,
  type VfsBlobIsolationAttachStatus
} from './sync-blob-isolation.js';
export {
  alwaysAvailableVfsBlobObjectStore,
  InMemoryVfsBlobObjectStore,
  type VfsBlobObjectStore
} from './sync-blob-object-store.js';
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
} from './sync-client.js';
export {
  InMemoryVfsCrdtSyncServer,
  type InMemoryVfsCrdtSyncServerSnapshot,
  InMemoryVfsCrdtSyncTransport
} from './sync-client-harness.js';
export {
  InMemoryVfsContainerClockStore,
  type ListVfsContainerClockChangesResult,
  type VfsContainerClockEntry
} from './sync-container-clocks.js';
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
} from './sync-crdt.js';
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
} from './sync-crdt-feed.js';
export {
  InMemoryVfsCrdtFeedReplayStore,
  VfsCrdtFeedReplayError,
  type VfsCrdtFeedReplaySnapshot,
  type VfsCrdtFeedReplayViolationCode
} from './sync-crdt-feed-replay.js';
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
} from './sync-crdt-reconcile.js';
export {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  type VfsSyncCursor
} from './sync-cursor.js';
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
} from './sync-engine.js';
export {
  VfsHttpCrdtSyncTransport,
  type VfsHttpCrdtSyncTransportOptions
} from './sync-http-transport.js';
export {
  compareVfsSyncCursorOrder,
  InMemoryVfsSyncClientStateStore,
  type ParsedVfsSyncReconcilePayload,
  type ParseVfsSyncReconcilePayloadResult,
  parseVfsSyncReconcilePayload,
  type ReconcileVfsSyncCursorResult,
  reconcileVfsSyncCursor
} from './sync-reconcile.js';
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
} from './sync-schema-contract.js';

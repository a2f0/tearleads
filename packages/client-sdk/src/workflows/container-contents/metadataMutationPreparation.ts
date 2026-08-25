import { base64ToBytes } from "@symcrypt/encoding";
import {
  encodeVersionVector,
  exportUpdatesSince,
  importUpdates,
} from "@symcrypt/loro";
import { canWriteEffectiveAccessLevel } from "../../data/accessLevel";
import {
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { documentSyncPullContinuationsEqual } from "../../data/documents/shared/syncPagination";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { ContainerDocumentRecord as DocumentRecord } from "./containerPersistence";
import {
  type ExpectedContainerMetadataSyncState,
  metadataSyncSecurityContextMatches,
  replaceSupersededMetadataIdentity,
  sameNullableMetadataValue,
} from "./metadataSyncSettlement";
import type {
  ContainerMetadataPatch,
  ContainerMetadataState,
} from "./metadataTypes";

export interface PersistContainerMetadataStateInput {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  execSql: ExecSql;
  expectedSyncState?: ExpectedContainerMetadataSyncState | undefined;
  localMetadataPatch?:
    | Partial<Pick<ContainerMetadataPatch, "icon" | "name">>
    | undefined;
  localUpdate?: Uint8Array | undefined;
  metadataState: ContainerMetadataState;
  patch?: Partial<ContainerMetadataPatch> | undefined;
  persistence: ContainerContentsPersistence;
  preserveDurableStructureWhenPending?: boolean | undefined;
  saveOptions?:
    | Parameters<ContainerContentsPersistence["saveContainer"]>[3]
    | undefined;
}

export function currentMetadataPullContinuation(
  metadataState: ContainerMetadataState,
) {
  return Object.hasOwn(metadataState, "pullContinuation")
    ? (metadataState.pullContinuation ?? null)
    : (metadataState.record.pullContinuation ?? null);
}

export function resolveMetadataSecurityContext(
  metadataState: ContainerMetadataState,
  patch: Partial<ContainerMetadataPatch>,
) {
  const currentDocumentId = metadataState.record.documentId ?? null;
  const documentId =
    patch.documentId !== undefined ? patch.documentId : currentDocumentId;
  const accessEpoch = patch.accessEpoch ?? metadataState.record.accessEpoch;
  const documentIdChanged = documentId !== currentDocumentId;

  return {
    accessEpoch,
    changed:
      documentIdChanged || accessEpoch !== metadataState.record.accessEpoch,
    documentId,
    documentIdChanged,
  };
}

function mergeDurableMetadataCheckpoint(input: {
  durableRecord: DocumentRecord | null;
  metadataState: ContainerMetadataState;
  securityContext: ReturnType<typeof resolveMetadataSecurityContext>;
}): void {
  const { durableRecord, metadataState, securityContext } = input;
  if (
    !durableRecord?.metadataUpdates ||
    durableRecord.documentId !== metadataState.record.documentId ||
    durableRecord.documentId !== securityContext.documentId ||
    durableRecord.accessEpoch !== metadataState.record.accessEpoch ||
    durableRecord.accessEpoch !== securityContext.accessEpoch
  ) {
    return;
  }

  importUpdates(metadataState.doc, [
    base64ToBytes(durableRecord.metadataUpdates),
  ]);
}

export async function loadAuthoritativeContainerMetadataState(input: {
  containerId: string;
  execSql: ExecSql;
  persistence: ContainerContentsPersistence;
}) {
  const stored = await input.persistence.loadContainerMetadataState(
    input.execSql,
    input.containerId,
  );
  return stored?.record
    ? { container: stored.container, record: stored.record }
    : null;
}

function localMetadataWriteAccessWasRevoked(input: {
  authoritativeState: NonNullable<
    Awaited<ReturnType<typeof loadAuthoritativeContainerMetadataState>>
  >;
  mutationInput: PersistContainerMetadataStateInput;
}): boolean {
  return (
    input.mutationInput.expectedSyncState === undefined &&
    input.mutationInput.localUpdate !== undefined &&
    canWriteEffectiveAccessLevel(
      input.mutationInput.metadataState.container.effectiveAccessLevel,
    ) &&
    !canWriteEffectiveAccessLevel(
      input.authoritativeState.container.effectiveAccessLevel,
    )
  );
}

async function prepareRebasedLocalMetadataMutation(input: {
  authoritativeState: NonNullable<
    Awaited<ReturnType<typeof loadAuthoritativeContainerMetadataState>>
  >;
  metadataState: ContainerMetadataState;
  localMetadataPatch:
    | Partial<Pick<ContainerMetadataPatch, "icon" | "name">>
    | undefined;
  patch: Partial<ContainerMetadataPatch>;
}) {
  const { authoritativeState, metadataState, patch } = input;
  const replacementVersion = encodeVersionVector(metadataState.doc);
  const replacementMetadata = readContainerMetadataValue(
    metadataState.doc,
    getDefaultContainerName(authoritativeState.container.parentId),
  );
  writeContainerMetadataValue(metadataState.doc, {
    ...replacementMetadata,
    ...input.localMetadataPatch,
  });
  const rebasedMetadataState = {
    ...metadataState,
    container: authoritativeState.container,
    pullContinuation: authoritativeState.record.pullContinuation ?? null,
    record: authoritativeState.record,
  };
  return {
    durableRecord: authoritativeState.record,
    mutationContainer: authoritativeState.container,
    mutationMetadataState: rebasedMetadataState,
    mutationPatch: patch,
    pendingLocalUpdate: exportUpdatesSince(
      metadataState.doc,
      replacementVersion,
    ),
    pullContinuationSuperseded: false,
    securityContext: resolveMetadataSecurityContext(
      rebasedMetadataState,
      patch,
    ),
    securityContextMatches: true,
  };
}

function resolveMetadataSettlementMatch(
  expectedSyncState: ExpectedContainerMetadataSyncState | undefined,
  durableRecord: DocumentRecord | null,
) {
  if (!expectedSyncState) {
    return {
      contentStateSuperseded: false,
      pullContinuationSuperseded: false,
      securityContextMatches: true,
    };
  }
  const securityContextMatches = metadataSyncSecurityContextMatches(
    durableRecord,
    expectedSyncState.record,
  );
  const progressStateMatches =
    securityContextMatches &&
    sameNullableMetadataValue(
      durableRecord?.lastCommitLsn,
      expectedSyncState.record.lastCommitLsn,
    ) &&
    Boolean(durableRecord?.pullContinuationRecoveryRequired) ===
      Boolean(expectedSyncState.record.pullContinuationRecoveryRequired) &&
    documentSyncPullContinuationsEqual(
      durableRecord?.pullContinuation,
      expectedSyncState.pullContinuation,
    );
  const contentStateMatches =
    progressStateMatches &&
    sameNullableMetadataValue(
      durableRecord?.metadataUpdates,
      expectedSyncState.record.metadataUpdates,
    ) &&
    sameNullableMetadataValue(
      durableRecord?.snapshotEndVersion,
      expectedSyncState.record.snapshotEndVersion,
    );
  return {
    contentStateSuperseded: progressStateMatches && !contentStateMatches,
    pullContinuationSuperseded: !progressStateMatches,
    securityContextMatches,
  };
}

export async function prepareContainerMetadataMutation(
  input: PersistContainerMetadataStateInput,
  execSql: ExecSql,
  patch: Partial<ContainerMetadataPatch>,
) {
  const { metadataState, persistence } = input;
  const authoritativeState = await loadAuthoritativeContainerMetadataState({
    containerId: metadataState.container.id,
    execSql,
    persistence,
  });
  if (!authoritativeState) {
    return {
      authoritativeState: null,
      pullContinuationSuperseded: true,
      securityContextMatches: false,
    };
  }
  if (
    localMetadataWriteAccessWasRevoked({
      authoritativeState,
      mutationInput: input,
    })
  ) {
    await replaceSupersededMetadataIdentity({
      durableRecord: authoritativeState.record,
      metadataState,
    });
    return {
      authoritativeState,
      pullContinuationSuperseded: true,
      securityContextMatches: false,
    };
  }
  const durableRecord = authoritativeState.record;
  const mutationMetadataState = durableRecord
    ? {
        ...metadataState,
        pullContinuation: durableRecord.pullContinuation ?? null,
        record: durableRecord,
      }
    : metadataState;
  const capturedSecurityContextMatches =
    durableRecord !== null &&
    metadataSyncSecurityContextMatches(durableRecord, metadataState.record);
  const {
    contentStateSuperseded,
    pullContinuationSuperseded,
    securityContextMatches,
  } = resolveMetadataSettlementMatch(input.expectedSyncState, durableRecord);

  if (
    input.expectedSyncState === undefined &&
    !capturedSecurityContextMatches
  ) {
    await replaceSupersededMetadataIdentity({
      durableRecord: authoritativeState.record,
      metadataState,
    });
    if (input.localUpdate === undefined) {
      return {
        authoritativeState,
        pullContinuationSuperseded: true,
        securityContextMatches: false,
      };
    }
    return prepareRebasedLocalMetadataMutation({
      authoritativeState,
      localMetadataPatch: input.localMetadataPatch,
      metadataState,
      patch,
    });
  }
  const mutationPatch = pullContinuationSuperseded ? {} : patch;
  const securityContext = resolveMetadataSecurityContext(
    mutationMetadataState,
    mutationPatch,
  );
  if (
    securityContextMatches &&
    (input.expectedSyncState === undefined || contentStateSuperseded)
  ) {
    mergeDurableMetadataCheckpoint({
      durableRecord,
      metadataState,
      securityContext,
    });
  }
  return {
    durableRecord,
    mutationContainer: authoritativeState.container,
    mutationMetadataState,
    mutationPatch,
    pendingLocalUpdate: input.localUpdate,
    pullContinuationSuperseded,
    securityContext,
    securityContextMatches,
  };
}

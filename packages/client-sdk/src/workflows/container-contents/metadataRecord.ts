import { bytesToBase64 } from "@symcrypt/encoding";
import { exportAllUpdates } from "@symcrypt/loro";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { ContainerDocumentRecord as DocumentRecord } from "./containerPersistence";
import {
  currentMetadataPullContinuation,
  type resolveMetadataSecurityContext,
} from "./metadataMutationPreparation";
import type {
  ContainerMetadataPatch,
  ContainerMetadataState,
} from "./metadataTypes";

type NullableContainerMetadataDocumentField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";

export function resolveContainerSystemSlot(
  patch: Partial<ContainerMetadataPatch>,
  container: ContainerRecord,
): NonNullable<ContainerRecord["systemSlot"]> | null {
  return patch.systemSlot ?? container.systemSlot ?? null;
}

export function resolveMetadataDocumentId(
  patch: Partial<ContainerMetadataPatch>,
  container: ContainerRecord,
): ContainerRecord["metadataDocumentId"] {
  return (
    patch.metadataDocumentId ?? patch.documentId ?? container.metadataDocumentId
  );
}

function resolveNullableContainerMetadataDocumentField(
  patch: Partial<ContainerMetadataPatch>,
  key: NullableContainerMetadataDocumentField,
  currentValue: string | null | undefined,
  resetWhenUnpatched = false,
): string | null {
  if (Object.hasOwn(patch, key)) return patch[key] ?? null;
  return resetWhenUnpatched ? null : (currentValue ?? null);
}

function resolveMetadataPullState(
  metadataState: ContainerMetadataState,
  patch: Partial<ContainerMetadataPatch>,
  securityContextChanged: boolean,
): Pick<
  DocumentRecord,
  "pullContinuation" | "pullContinuationRecoveryRequired"
> {
  if (Object.hasOwn(patch, "pullContinuation")) {
    return { pullContinuation: patch.pullContinuation ?? null };
  }
  if (securityContextChanged) return { pullContinuation: null };
  if (metadataState.record.pullContinuationRecoveryRequired) {
    return { pullContinuationRecoveryRequired: true };
  }
  return { pullContinuation: currentMetadataPullContinuation(metadataState) };
}

export function buildContainerMetadataRecord(input: {
  metadataState: ContainerMetadataState;
  patch: Partial<ContainerMetadataPatch>;
  securityContext: ReturnType<typeof resolveMetadataSecurityContext>;
}): DocumentRecord {
  const { metadataState, patch, securityContext } = input;
  return {
    id: metadataState.container.id,
    documentId: securityContext.documentId,
    metadataUpdates:
      patch.metadataUpdates ??
      bytesToBase64(exportAllUpdates(metadataState.doc)),
    snapshotEndVersion: "",
    accessEpoch: securityContext.accessEpoch,
    accessStateHash: resolveNullableContainerMetadataDocumentField(
      patch,
      "accessStateHash",
      metadataState.record.accessStateHash,
      securityContext.changed,
    ),
    lastCommitLsn: resolveNullableContainerMetadataDocumentField(
      patch,
      "lastCommitLsn",
      metadataState.record.lastCommitLsn,
      securityContext.documentIdChanged,
    ),
    contentKeyBundle: resolveNullableContainerMetadataDocumentField(
      patch,
      "contentKeyBundle",
      metadataState.record.contentKeyBundle,
      securityContext.changed,
    ),
    documentKekTargets: resolveNullableContainerMetadataDocumentField(
      patch,
      "documentKekTargets",
      metadataState.record.documentKekTargets,
      securityContext.changed,
    ),
    documentManifestBundle: resolveNullableContainerMetadataDocumentField(
      patch,
      "documentManifestBundle",
      metadataState.record.documentManifestBundle,
      securityContext.changed,
    ),
    ...resolveMetadataPullState(metadataState, patch, securityContext.changed),
  };
}

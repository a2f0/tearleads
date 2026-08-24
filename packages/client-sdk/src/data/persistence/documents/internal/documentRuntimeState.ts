import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../../documents/documentConstants";
import type { StoredDocumentRecord } from "../types";

function didPersistedDocumentSecurityContextChange(
  existingDocument: StoredDocumentRecord | null | undefined,
  input: {
    accessEpoch: number;
    documentId: string | null;
  },
): boolean {
  return (
    existingDocument?.documentId !== input.documentId ||
    (existingDocument?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH) !==
      input.accessEpoch
  );
}

export function resolvePersistedDocumentRuntimeState(
  existingDocument: StoredDocumentRecord | null | undefined,
  input: {
    accessEpoch: number;
    documentId: string | null;
  },
): Pick<
  StoredDocumentRecord,
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle"
  | "pullContinuation"
  | "pullContinuationRecoveryRequired"
> {
  const documentIdChanged = existingDocument?.documentId !== input.documentId;
  const securityContextChanged = didPersistedDocumentSecurityContextChange(
    existingDocument,
    input,
  );

  return {
    lastCommitLsn: documentIdChanged
      ? null
      : (existingDocument?.lastCommitLsn ?? null),
    contentKeyBundle: securityContextChanged
      ? null
      : (existingDocument?.contentKeyBundle ?? null),
    documentKekTargets: securityContextChanged
      ? null
      : (existingDocument?.documentKekTargets ?? null),
    documentManifestBundle: securityContextChanged
      ? null
      : (existingDocument?.documentManifestBundle ?? null),
    ...(securityContextChanged
      ? { pullContinuation: null }
      : existingDocument?.pullContinuationRecoveryRequired
        ? { pullContinuationRecoveryRequired: true as const }
        : { pullContinuation: existingDocument?.pullContinuation ?? null }),
  };
}

export function resolvePersistedAccessStateHash(
  existingDocument: StoredDocumentRecord | null | undefined,
  input: {
    accessEpoch: number;
    accessStateHash?: string | null | undefined;
    documentId: string | null;
  },
): string | null {
  if (input.accessStateHash !== undefined) {
    return input.accessStateHash;
  }

  const securityContextChanged = didPersistedDocumentSecurityContextChange(
    existingDocument,
    input,
  );
  return securityContextChanged
    ? null
    : (existingDocument?.accessStateHash ?? null);
}

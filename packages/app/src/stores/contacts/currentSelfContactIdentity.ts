import { deriveStableDocumentId } from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { loadDocumentIdentityCandidates } from "../documents/documentIdentityCandidates";
import { getSelfContactLocalId } from "./selfContact";

export interface CurrentSelfContactIdentity {
  readonly documentId: string;
  readonly localId: string;
  readonly localIds: ReadonlySet<string>;
}

export async function loadCurrentSelfContactIdentity(
  execSql: ExecSql,
  fingerprint: string,
): Promise<CurrentSelfContactIdentity> {
  const localId = getSelfContactLocalId(fingerprint);
  const documentId = await deriveStableDocumentId(localId);
  const aliases = await loadDocumentIdentityCandidates(execSql, documentId, [
    localId,
  ]);
  const localIds = new Set([localId]);
  for (const alias of aliases) {
    // Persisted identity takes precedence over planned local birth identity.
    // Read the whole document namespace: an alias can live outside Contacts.
    const persistedId = alias.documentId ?? alias.recoveryDocumentId;
    if (persistedId === documentId || persistedId === null) {
      localIds.add(alias.localId);
    } else {
      localIds.delete(alias.localId);
    }
  }
  return {
    documentId,
    localId,
    localIds,
  };
}

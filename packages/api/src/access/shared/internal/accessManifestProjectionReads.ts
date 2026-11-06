import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifestPrincipalHeadProjection,
} from "@tearleads/api-shared/schema";
import type {
  AccessObjectKind,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { uniqueSortedStrings as unique } from "../../../utils/array";

/**
 * access projection tables are derived cache only.
 *
 * Callers must verify signed access events and manifests with the crypto
 * package before trusting any row returned here for authorization decisions.
 */

interface StoredAccessManifestPrincipalHeadProjection
  extends ReferencedPrincipalHead {
  readonly manifestHash: string;
  readonly objectKind: AccessObjectKind;
  readonly objectId: string;
}

export interface StoredAccessManifestDocumentLinkProjection {
  readonly manifestHash: string;
  readonly documentId: string;
  readonly containerId: string;
}

export async function listAccessManifestPrincipalHeadProjection(
  manifestHash: string,
  executor: DatabaseSession,
): Promise<StoredAccessManifestPrincipalHeadProjection[]> {
  return executor
    .select({
      manifestHash: accessManifestPrincipalHeadProjection.manifestHash,
      objectKind: accessManifestPrincipalHeadProjection.objectKind,
      objectId: accessManifestPrincipalHeadProjection.objectId,
      principalType: accessManifestPrincipalHeadProjection.principalType,
      principalId: accessManifestPrincipalHeadProjection.principalId,
      version: accessManifestPrincipalHeadProjection.version,
      keyEpoch: accessManifestPrincipalHeadProjection.keyEpoch,
      stateHash: accessManifestPrincipalHeadProjection.stateHash,
      keyFingerprint: accessManifestPrincipalHeadProjection.keyFingerprint,
    })
    .from(accessManifestPrincipalHeadProjection)
    .where(eq(accessManifestPrincipalHeadProjection.manifestHash, manifestHash))
    .orderBy(
      asc(accessManifestPrincipalHeadProjection.principalType),
      asc(accessManifestPrincipalHeadProjection.principalId),
    );
}

export async function listAccessManifestDocumentLinkProjections(
  manifestHashes: readonly string[],
  executor: DatabaseSession,
): Promise<StoredAccessManifestDocumentLinkProjection[]> {
  const uniqueManifestHashes = unique(manifestHashes);

  if (uniqueManifestHashes.length === 0) {
    return [];
  }

  return executor
    .select({
      manifestHash: accessManifestDocumentLinkProjection.manifestHash,
      documentId: accessManifestDocumentLinkProjection.documentId,
      containerId: accessManifestDocumentLinkProjection.containerId,
    })
    .from(accessManifestDocumentLinkProjection)
    .where(
      inArray(
        accessManifestDocumentLinkProjection.manifestHash,
        uniqueManifestHashes,
      ),
    )
    .orderBy(
      asc(accessManifestDocumentLinkProjection.manifestHash),
      asc(accessManifestDocumentLinkProjection.containerId),
    );
}

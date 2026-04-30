import type { ListContainerDocumentsResponse } from "@tearleads/validators/response";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  containerMetadataDocuments,
  documents,
} from "../../schema";
import {
  collectReferencedPrincipalsFromContainerAccess,
  KeyingReadAccessError,
  resolveReadableContainerAccess,
} from "../keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";

export class ListContainerDocumentsError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
  }
}

async function requireReadableContainer(
  runtime: ApiServiceRuntime,
  containerId: string,
  userId: string,
) {
  try {
    return await resolveReadableContainerAccess({
      containerId,
      executor: runtime.db,
      userId,
    });
  } catch (error) {
    if (error instanceof KeyingReadAccessError) {
      throw new ListContainerDocumentsError(error.message, error.status);
    }
    throw error;
  }
}

async function loadCurrentContainerDocumentRows(
  runtime: ApiServiceRuntime,
  containerId: string,
): Promise<
  {
    createdAt: Date;
    documentId: string;
    manifestHash: string;
    manifestEpoch: number;
  }[]
> {
  return runtime.db
    .select({
      createdAt: documents.createdAt,
      documentId: accessManifestHeads.objectId,
      manifestHash: accessManifestHeads.manifestHash,
      manifestEpoch: accessManifestHeads.epoch,
    })
    .from(accessManifestHeads)
    .innerJoin(
      accessManifestDocumentLinkProjection,
      and(
        eq(
          accessManifestDocumentLinkProjection.manifestHash,
          accessManifestHeads.manifestHash,
        ),
        eq(accessManifestDocumentLinkProjection.containerId, containerId),
      ),
    )
    .innerJoin(
      documents,
      sql`${documents.id}::text = ${accessManifestHeads.objectId}`,
    )
    .leftJoin(
      containerMetadataDocuments,
      eq(containerMetadataDocuments.documentId, documents.id),
    )
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        isNull(containerMetadataDocuments.documentId),
      ),
    )
    .orderBy(desc(documents.createdAt), accessManifestHeads.objectId);
}

async function loadLinkedContainerIdsByManifestHash(
  runtime: ApiServiceRuntime,
  manifestHashes: ReadonlyArray<string>,
) {
  const linkedContainerRows =
    manifestHashes.length === 0
      ? []
      : await runtime.db
          .select({
            containerId: accessManifestDocumentLinkProjection.containerId,
            manifestHash: accessManifestDocumentLinkProjection.manifestHash,
          })
          .from(accessManifestDocumentLinkProjection)
          .where(
            inArray(
              accessManifestDocumentLinkProjection.manifestHash,
              manifestHashes,
            ),
          );
  const linkedContainerIdsByManifestHash = new Map<string, string[]>();

  for (const manifestHash of manifestHashes) {
    linkedContainerIdsByManifestHash.set(manifestHash, []);
  }

  for (const row of linkedContainerRows) {
    linkedContainerIdsByManifestHash
      .get(row.manifestHash)
      ?.push(row.containerId);
  }

  for (const [
    manifestHash,
    linkedContainerIds,
  ] of linkedContainerIdsByManifestHash) {
    linkedContainerIdsByManifestHash.set(
      manifestHash,
      [...new Set(linkedContainerIds)].sort(),
    );
  }

  return linkedContainerIdsByManifestHash;
}

export async function listContainerDocuments(
  runtime: ApiServiceRuntime,
  containerId: string,
  userId: string,
): Promise<ListContainerDocumentsResponse> {
  const containerAccess = await requireReadableContainer(
    runtime,
    containerId,
    userId,
  );
  const documentRows = await loadCurrentContainerDocumentRows(
    runtime,
    containerId,
  );
  const linkedContainerIdsByManifestHash =
    await loadLinkedContainerIdsByManifestHash(
      runtime,
      documentRows.map((row) => row.manifestHash),
    );
  const referencedPrincipals = collectReferencedPrincipalsFromContainerAccess([
    containerAccess,
  ]);

  const responseBody: ListContainerDocumentsResponse = [];

  for (const documentRow of documentRows) {
    responseBody.push({
      createdAt: documentRow.createdAt.toISOString(),
      currentAccessEpoch: documentRow.manifestEpoch,
      currentAccessStateHash: documentRow.manifestHash,
      id: documentRow.documentId,
      linkedContainerIds:
        linkedContainerIdsByManifestHash.get(documentRow.manifestHash) ?? [],
      referencedPrincipals,
    });
  }

  return responseBody;
}

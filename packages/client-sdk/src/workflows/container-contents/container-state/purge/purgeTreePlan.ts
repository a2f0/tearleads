import type { DocumentSummary } from "../../../../data/documents/documentSummary";
import { DocumentContainerProjectionRepository } from "../../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { listDocumentsByContainerIdsOrDocumentIds } from "../../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";

export interface SubtreeDocumentPlan {
  // Synced documents whose every link falls inside the subtree: reduce them to
  // one retained link, as required by the purge endpoint, then destroy them.
  readonly purge: readonly {
    document: DocumentSummary;
    retainedContainerId: string | null;
    unlinkContainerIds: readonly string[];
  }[];
  // Synced documents also linked outside the subtree: keep them, but unlink
  // from each in-subtree container so the containers can be deleted.
  readonly unlinkByDocument: ReadonlyMap<
    string,
    { document: DocumentSummary; containerIds: readonly string[] }
  >;
  // Never-synced documents (no remote id): destroy locally only.
  readonly purgeLocal: readonly DocumentSummary[];
}

type SubtreeDocumentDisposition =
  | {
      kind: "purge";
      retainedContainerId: string | null;
      unlinkContainerIds: readonly string[];
    }
  | { kind: "purge-local" }
  | { kind: "unlink"; containerIds: readonly string[] };

// Destroy local-only documents locally. Destroy synced documents only when all
// links are in the subtree; preserve documents with an external link. The purge
// plan reduces owned documents to the server-required sole link first.
export function classifySubtreeDocument(input: {
  readonly documentId: string | null;
  readonly linkedContainerIds: readonly string[];
  readonly preferredContainerId?: string | null | undefined;
  readonly subtreeContainerIds: ReadonlySet<string>;
}): SubtreeDocumentDisposition {
  if (!input.documentId) {
    return { kind: "purge-local" };
  }
  const hasExternalLink = input.linkedContainerIds.some(
    (containerId) => !input.subtreeContainerIds.has(containerId),
  );
  if (!hasExternalLink) {
    const linkedContainerIds = Array.from(
      new Set(
        input.linkedContainerIds.filter((containerId) =>
          input.subtreeContainerIds.has(containerId),
        ),
      ),
    );
    const retainedContainerId =
      (input.preferredContainerId &&
      linkedContainerIds.includes(input.preferredContainerId)
        ? input.preferredContainerId
        : linkedContainerIds[0]) ?? null;
    return {
      kind: "purge",
      retainedContainerId,
      unlinkContainerIds: linkedContainerIds.filter(
        (containerId) => containerId !== retainedContainerId,
      ),
    };
  }
  return {
    kind: "unlink",
    containerIds: input.linkedContainerIds.filter((containerId) =>
      input.subtreeContainerIds.has(containerId),
    ),
  };
}

export async function planSubtreeDocuments(input: {
  readonly execSql: ExecSql;
  readonly subtreeContainerIds: ReadonlySet<string>;
}): Promise<SubtreeDocumentPlan> {
  const links = new DocumentContainerProjectionRepository(input.execSql);
  const subtreeContainerList = [...input.subtreeContainerIds];
  const linkedDocumentIds =
    await links.listDocumentIdsByContainerIds(subtreeContainerList);
  const documents = await listDocumentsByContainerIdsOrDocumentIds(
    input.execSql,
    {
      containerIds: subtreeContainerList,
      documentIds: linkedDocumentIds,
    },
  );
  const remoteDocumentIds = documents.flatMap((document) =>
    document.documentId ? [document.documentId] : [],
  );
  const linkedContainerIdsByDocumentId =
    await links.listLinkedContainerIdsByDocumentIds(remoteDocumentIds);

  const purge: Array<{
    document: DocumentSummary;
    retainedContainerId: string | null;
    unlinkContainerIds: readonly string[];
  }> = [];
  const purgeLocal: DocumentSummary[] = [];
  const unlinkByDocument = new Map<
    string,
    { document: DocumentSummary; containerIds: readonly string[] }
  >();
  for (const document of documents) {
    const disposition = classifySubtreeDocument({
      documentId: document.documentId ?? null,
      linkedContainerIds: document.documentId
        ? (linkedContainerIdsByDocumentId.get(document.documentId) ?? [])
        : [],
      preferredContainerId: document.containerId,
      subtreeContainerIds: input.subtreeContainerIds,
    });
    if (disposition.kind === "purge-local") {
      purgeLocal.push(document);
    } else if (disposition.kind === "purge") {
      purge.push({
        document,
        retainedContainerId: disposition.retainedContainerId,
        unlinkContainerIds: disposition.unlinkContainerIds,
      });
    } else if (document.documentId) {
      unlinkByDocument.set(document.documentId, {
        document,
        containerIds: disposition.containerIds,
      });
    }
  }

  return { purge, purgeLocal, unlinkByDocument };
}

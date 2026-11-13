import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  documents,
} from "@tearleads/api-shared/schema";
import type { AccessObjectKind } from "@tearleads/crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { uniqueSortedStrings as unique } from "../../../utils/array";
import {
  type StoredAccessManifestHead,
  toStoredAccessManifestHead,
} from "./accessManifestHeadLocks";
import type { StoredAccessManifestDocumentLinkProjection } from "./accessManifestProjectionReads";

export async function loadCurrentAccessManifestHead(
  objectKind: AccessObjectKind,
  objectId: string,
  executor: DatabaseSession,
): Promise<StoredAccessManifestHead | null> {
  const [head] = await executor
    .select()
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, objectKind),
        eq(accessManifestHeads.objectId, objectId),
      ),
    )
    .limit(1);

  return head ? toStoredAccessManifestHead(head) : null;
}

export async function getCurrentAccessManifestHead(
  objectKind: AccessObjectKind,
  objectId: string,
  executor: DatabaseSession,
): Promise<StoredAccessManifestHead | null> {
  return loadCurrentAccessManifestHead(objectKind, objectId, executor);
}

export async function getCurrentAccessManifestHeads(
  objectKind: AccessObjectKind,
  objectIds: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, StoredAccessManifestHead>> {
  const uniqueObjectIds = unique(objectIds);
  if (uniqueObjectIds.length === 0) {
    return new Map();
  }

  const heads = await executor
    .select()
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, objectKind),
        inArray(accessManifestHeads.objectId, uniqueObjectIds),
      ),
    );

  return new Map(
    heads.map((head) => [head.objectId, toStoredAccessManifestHead(head)]),
  );
}

/** A document's current head and its link projection rows, in one read. */
export async function getCurrentDocumentHeadWithLinks(
  documentId: string,
  executor: DatabaseSession,
): Promise<{
  readonly head: StoredAccessManifestHead;
  readonly links: StoredAccessManifestDocumentLinkProjection[];
} | null> {
  const rows = await executor
    .select({
      head: accessManifestHeads,
      link: {
        manifestHash: accessManifestDocumentLinkProjection.manifestHash,
        documentId: accessManifestDocumentLinkProjection.documentId,
        containerId: accessManifestDocumentLinkProjection.containerId,
      },
    })
    .from(accessManifestHeads)
    .leftJoin(
      accessManifestDocumentLinkProjection,
      eq(
        accessManifestDocumentLinkProjection.manifestHash,
        accessManifestHeads.manifestHash,
      ),
    )
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, documentId),
      ),
    )
    .orderBy(asc(accessManifestDocumentLinkProjection.containerId));
  const [first] = rows;
  if (!first) return null;
  return {
    head: toStoredAccessManifestHead(first.head),
    links: rows.flatMap(({ link }) => (link ? [link] : [])),
  };
}

/** Keep authoritative existence distinct from a missing/corrupt head. */
export async function getDocumentWithCurrentHeadAndLinks(
  documentId: string,
  executor: DatabaseSession,
) {
  const rows = await executor
    .select({
      documentId: documents.id,
      head: accessManifestHeads,
      link: {
        manifestHash: accessManifestDocumentLinkProjection.manifestHash,
        documentId: accessManifestDocumentLinkProjection.documentId,
        containerId: accessManifestDocumentLinkProjection.containerId,
      },
    })
    .from(documents)
    .leftJoin(
      accessManifestHeads,
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, documents.id),
      ),
    )
    .leftJoin(
      accessManifestDocumentLinkProjection,
      eq(
        accessManifestDocumentLinkProjection.manifestHash,
        accessManifestHeads.manifestHash,
      ),
    )
    .where(eq(documents.id, documentId))
    .orderBy(asc(accessManifestDocumentLinkProjection.containerId));
  const first = rows[0];
  return {
    exists: first !== undefined,
    current: first?.head
      ? {
          head: toStoredAccessManifestHead(first.head),
          links: rows.flatMap(({ link }) => (link ? [link] : [])),
        }
      : null,
  };
}

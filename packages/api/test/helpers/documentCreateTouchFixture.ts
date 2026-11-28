import { expect } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  containerMetadataDocuments,
  containers,
  documents,
} from "@tearleads/api-shared/schema";
import { organizationRosterProfileContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq } from "drizzle-orm";
import type { Logger } from "drizzle-orm/logger";

interface CreateQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Observe real statements without replacing transaction identities or data. */
export async function traceDocumentCreate<T>(run: () => Promise<T>) {
  const session: unknown = Reflect.get(db, "session");
  if (typeof session !== "object" || session === null) {
    throw new Error("Expected a Drizzle session");
  }
  const logger = Reflect.get(session, "logger") as Logger;
  const original = logger.logQuery;
  const scope = new AsyncLocalStorage<boolean>();
  const queries: CreateQuery[] = [];
  // A plain wrapper composes with the optional measurement preload's observer.
  logger.logQuery = (sql, params) => {
    original.call(logger, sql, params);
    if (scope.getStore()) queries.push({ sql, params: [...params] });
  };
  try {
    return { result: await scope.run(true, run), queries };
  } finally {
    logger.logQuery = original;
  }
}

/** Return touch counts only after checking durable timestamps and attribution. */
export async function seedTouchCounts(
  queries: readonly CreateQuery[],
  documentIds: readonly string[],
): Promise<number[]> {
  const counts: number[] = [];
  for (const documentId of documentIds) {
    const inserted = queries.findIndex(
      ({ sql, params }) =>
        sql.startsWith('insert into "documents" ') &&
        params.includes(documentId),
    );
    const updateInserted = queries.findIndex(
      ({ sql, params }, index) =>
        index > inserted &&
        sql.startsWith('insert into "document_updates" ') &&
        params.includes(documentId),
    );
    expect(inserted).toBeGreaterThanOrEqual(0);
    expect(updateInserted).toBeGreaterThan(inserted);
    // The `count_document_updates` trigger updates `documents` (count,
    // attribution_revision, updated_at) on `document_updates` insert, so no
    // separate SQL `update "documents"` should follow.
    expect(
      queries
        .slice(inserted + 1)
        .filter(
          ({ sql, params }) =>
            sql.startsWith('update "documents" ') &&
            params.includes(documentId),
        ),
    ).toHaveLength(0);
    const finalTouchIndex = queries.findIndex(
      ({ sql }, index) =>
        index > updateInserted &&
        sql.startsWith('update "containers" set "updated_at"'),
    );
    const finalTouch = queries[finalTouchIndex];
    expect(finalTouchIndex).toBeGreaterThan(updateInserted);
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));
    if (!document || !finalTouch)
      throw new Error("Missing committed seed touch");
    expect(document.attributionRevision).toBe(1);
    expect(document.updateCount).toBe(1);
    expect(document.updatedAt.getTime()).toBeGreaterThanOrEqual(
      document.createdAt.getTime(),
    );
    expect(
      new Date(String(finalTouch.params[0])).getTime(),
    ).toBeGreaterThanOrEqual(document.updatedAt.getTime());
    const [metadataBinding] = await db
      .select({ documentId: containerMetadataDocuments.documentId })
      .from(containerMetadataDocuments)
      .where(eq(containerMetadataDocuments.documentId, documentId))
      .limit(1);
    const linked = await db
      .select({
        id: containers.id,
        organizationId: containers.organizationId,
        systemSlot: containers.systemSlot,
        updatedAt: containers.updatedAt,
      })
      .from(accessManifestDocumentLinkProjection)
      .innerJoin(
        containers,
        eq(containers.id, accessManifestDocumentLinkProjection.containerId),
      )
      .where(eq(accessManifestDocumentLinkProjection.documentId, documentId));
    expect(linked.length).toBeGreaterThan(0);
    for (const container of linked) {
      expect(finalTouch.params).toContain(container.id);
      const suppressedRosterProfileWrite =
        !metadataBinding &&
        container.systemSlot ===
          organizationRosterProfileContainerSystemSlot(
            container.organizationId,
          );
      if (suppressedRosterProfileWrite) {
        continue;
      }
      // A later seed or structure write may touch the same container again.
      expect(container.updatedAt.getTime()).toBeGreaterThanOrEqual(
        document.updatedAt.getTime(),
      );
    }
    counts.push(
      queries
        .slice(inserted, finalTouchIndex + 1)
        .filter(({ sql }) =>
          sql.startsWith('update "containers" set "updated_at"'),
        ).length,
    );
  }
  return counts;
}

export async function unseededTouchCount(
  queries: readonly CreateQuery[],
  documentId: string,
): Promise<number> {
  const inserted = queries.findIndex(
    ({ sql, params }) =>
      sql.startsWith('insert into "documents" ') && params.includes(documentId),
  );
  expect(inserted).toBeGreaterThanOrEqual(0);
  const afterInsert = queries.slice(inserted);
  expect(
    afterInsert.filter(({ sql }) => sql.startsWith('update "documents" ')),
  ).toHaveLength(0);
  const touches = afterInsert.filter(({ sql }) =>
    sql.startsWith('update "containers" set "updated_at"'),
  );
  const linked = await db
    .select({ document: documents, container: containers })
    .from(documents)
    .innerJoin(
      accessManifestDocumentLinkProjection,
      eq(accessManifestDocumentLinkProjection.documentId, documents.id),
    )
    .innerJoin(
      containers,
      eq(containers.id, accessManifestDocumentLinkProjection.containerId),
    )
    .where(eq(documents.id, documentId));
  expect(linked.length).toBeGreaterThan(0);
  for (const { document, container } of linked) {
    expect(document.attributionRevision).toBe(0);
    const touch = touches.find(({ params }) => params.includes(container.id));
    if (!touch) throw new Error("Missing unseeded container touch");
    expect(container.updatedAt.getTime()).toBe(
      new Date(String(touch.params[0])).getTime(),
    );
    expect(container.updatedAt.getTime()).toBeGreaterThanOrEqual(
      document.updatedAt.getTime(),
    );
  }
  return touches.length;
}

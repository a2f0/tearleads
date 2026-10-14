import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";

export async function expectDocumentAccessHistoryAbsent(
  documentId: string,
): Promise<void> {
  const objectFilter = (objectKind: typeof accessEvents.objectKind) =>
    and(eq(objectKind, "document"), eq(accessEvents.objectId, documentId));
  const [events, links, heads, manifests, principalHeads] = await Promise.all([
    db.select().from(accessEvents).where(objectFilter(accessEvents.objectKind)),
    db
      .select()
      .from(accessManifestDocumentLinkProjection)
      .where(eq(accessManifestDocumentLinkProjection.documentId, documentId)),
    db
      .select()
      .from(accessManifestHeads)
      .where(
        and(
          eq(accessManifestHeads.objectKind, "document"),
          eq(accessManifestHeads.objectId, documentId),
        ),
      ),
    db
      .select()
      .from(accessManifests)
      .where(
        and(
          eq(accessManifests.objectKind, "document"),
          eq(accessManifests.objectId, documentId),
        ),
      ),
    db
      .select()
      .from(accessManifestPrincipalHeadProjection)
      .where(
        and(
          eq(accessManifestPrincipalHeadProjection.objectKind, "document"),
          eq(accessManifestPrincipalHeadProjection.objectId, documentId),
        ),
      ),
  ]);
  expect({
    events,
    heads,
    links,
    manifests,
    principalHeads,
  }).toEqual({
    events: [],
    heads: [],
    links: [],
    manifests: [],
    principalHeads: [],
  });
}

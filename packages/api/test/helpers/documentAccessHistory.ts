import { expect } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  accessEventDependencyProjection,
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
} from "@symcrypt/api-shared/schema";
import { and, eq } from "drizzle-orm";

export async function expectDocumentAccessHistoryAbsent(
  documentId: string,
): Promise<void> {
  const objectFilter = (objectKind: typeof accessEvents.objectKind) =>
    and(eq(objectKind, "document"), eq(accessEvents.objectId, documentId));
  const [events, dependencies, links, heads, manifests, principalHeads] =
    await Promise.all([
      db
        .select()
        .from(accessEvents)
        .where(objectFilter(accessEvents.objectKind)),
      db
        .select()
        .from(accessEventDependencyProjection)
        .where(
          and(
            eq(accessEventDependencyProjection.objectKind, "document"),
            eq(accessEventDependencyProjection.objectId, documentId),
          ),
        ),
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
    dependencies,
    events,
    heads,
    links,
    manifests,
    principalHeads,
  }).toEqual({
    dependencies: [],
    events: [],
    heads: [],
    links: [],
    manifests: [],
    principalHeads: [],
  });
}

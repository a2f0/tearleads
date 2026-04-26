import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "./adapters/postgres";
import { documentUpdateSpans } from "./schema";

test("document_update_spans stores visible causal index rows", async () => {
  const documentId = crypto.randomUUID();
  const updateId = crypto.randomUUID();

  await db.insert(documentUpdateSpans).values([
    {
      documentId,
      updateId,
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
    },
    {
      documentId,
      updateId,
      peerId: "2",
      startCounter: 4,
      endCounter: 9,
    },
  ]);

  const spans = await db
    .select({
      endCounter: documentUpdateSpans.endCounter,
      peerId: documentUpdateSpans.peerId,
      startCounter: documentUpdateSpans.startCounter,
    })
    .from(documentUpdateSpans)
    .where(eq(documentUpdateSpans.updateId, updateId))
    .orderBy(documentUpdateSpans.peerId);

  expect(spans).toEqual([
    {
      endCounter: 3,
      peerId: "1",
      startCounter: 0,
    },
    {
      endCounter: 9,
      peerId: "2",
      startCounter: 4,
    },
  ]);
});

test("V2 access manifest schema creates tables and indexes", async () => {
  const result = await db.execute(sql`
    select
      to_regclass('access_events') is not null as "accessEvents",
      to_regclass('access_manifests') is not null as "accessManifests",
      to_regclass('access_manifest_heads') is not null as "accessManifestHeads",
      to_regclass('access_event_dependency_projection') is not null
        as "accessEventDependencyProjection",
      to_regclass('access_manifest_principal_head_projection') is not null
        as "accessManifestPrincipalHeadProjection",
      to_regclass('access_events_event_hash_idx') is not null
        as "accessEventsEventHashIndex",
      to_regclass('access_manifests_object_epoch_idx') is not null
        as "accessManifestsObjectEpochIndex",
      to_regclass('access_manifest_heads_object_idx') is not null
        as "accessManifestHeadsObjectIndex",
      (
        select data_type
        from information_schema.columns
        where table_name = 'access_events'
          and column_name = 'dependency_manifest_hashes'
      ) = 'jsonb' as "accessEventsDependenciesJsonb",
      (
        select data_type
        from information_schema.columns
        where table_name = 'access_events'
          and column_name = 'body'
      ) = 'jsonb' as "accessEventsBodyJsonb",
      (
        select data_type
        from information_schema.columns
        where table_name = 'access_manifests'
          and column_name = 'referenced_principal_heads'
      ) = 'jsonb' as "accessManifestsPrincipalHeadsJsonb"
  `);

  expect(result.rows[0]).toEqual({
    accessEvents: true,
    accessManifests: true,
    accessManifestHeads: true,
    accessEventDependencyProjection: true,
    accessManifestPrincipalHeadProjection: true,
    accessEventsEventHashIndex: true,
    accessManifestsObjectEpochIndex: true,
    accessManifestHeadsObjectIndex: true,
    accessEventsDependenciesJsonb: true,
    accessEventsBodyJsonb: true,
    accessManifestsPrincipalHeadsJsonb: true,
  });
});

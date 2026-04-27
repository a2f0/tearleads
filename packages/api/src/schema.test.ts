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
      to_regclass('container_key_epochs') is not null
        as "containerKeyEpochs",
      to_regclass('container_key_wraps') is not null
        as "containerKeyWraps",
      to_regclass('access_event_dependency_projection') is not null
        as "accessEventDependencyProjection",
      to_regclass('access_manifest_principal_head_projection') is not null
        as "accessManifestPrincipalHeadProjection",
      to_regclass('access_manifest_document_link_projection') is not null
        as "accessManifestDocumentLinkProjection",
      to_regclass('document_content_key_epochs') is not null
        as "documentContentKeyEpochs",
      to_regclass('document_content_key_targets') is not null
        as "documentContentKeyTargets",
      to_regclass('document_content_write_headers') is not null
        as "documentContentWriteHeaders",
      to_regclass('blob_content_key_epochs') is not null
        as "blobContentKeyEpochs",
      to_regclass('blob_content_key_targets') is not null
        as "blobContentKeyTargets",
      to_regclass('blob_content_write_headers') is not null
        as "blobContentWriteHeaders",
      to_regclass('access_events_event_hash_idx') is not null
        as "accessEventsEventHashIndex",
      to_regclass('access_manifests_object_epoch_idx') is not null
        as "accessManifestsObjectEpochIndex",
      to_regclass('access_manifest_heads_object_idx') is not null
        as "accessManifestHeadsObjectIndex",
      to_regclass('container_key_epochs_container_epoch_idx') is not null
        as "containerKeyEpochsContainerEpochIndex",
      to_regclass('container_key_wraps_epoch_recipient_idx') is not null
        as "containerKeyWrapsEpochRecipientIndex",
      to_regclass('access_manifest_document_link_unique_idx') is not null
        as "accessManifestDocumentLinkUniqueIndex",
      to_regclass('document_content_key_epochs_document_epoch_idx') is not null
        as "documentContentKeyEpochsDocumentEpochIndex",
      to_regclass('document_content_key_targets_epoch_container_idx') is not null
        as "documentContentKeyTargetsEpochContainerIndex",
      to_regclass('document_content_write_headers_header_hash_idx') is not null
        as "documentContentWriteHeadersHeaderHashIndex",
      to_regclass('document_content_write_headers_content_record_idx') is not null
        as "documentContentWriteHeadersContentRecordIndex",
      to_regclass('document_content_write_headers_nonce_domain_idx') is not null
        as "documentContentWriteHeadersNonceDomainIndex",
      to_regclass('blob_content_key_epochs_blob_epoch_idx') is not null
        as "blobContentKeyEpochsBlobEpochIndex",
      to_regclass('blob_content_key_targets_epoch_binding_container_idx') is not null
        as "blobContentKeyTargetsEpochBindingContainerIndex",
      to_regclass('blob_content_write_headers_header_hash_idx') is not null
        as "blobContentWriteHeadersHeaderHashIndex",
      to_regclass('blob_content_write_headers_content_record_idx') is not null
        as "blobContentWriteHeadersContentRecordIndex",
      to_regclass('blob_content_write_headers_nonce_domain_idx') is not null
        as "blobContentWriteHeadersNonceDomainIndex",
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
      ) = 'jsonb' as "accessManifestsPrincipalHeadsJsonb",
      (
        select data_type
        from information_schema.columns
        where table_name = 'document_content_key_targets'
          and column_name = 'wrapping_metadata'
      ) = 'jsonb' as "documentContentKeyTargetsMetadataJsonb",
      (
        select data_type
        from information_schema.columns
        where table_name = 'document_content_write_headers'
          and column_name = 'header'
      ) = 'jsonb' as "documentContentWriteHeadersHeaderJsonb",
      (
        select data_type
        from information_schema.columns
        where table_name = 'blob_content_key_targets'
          and column_name = 'wrapping_metadata'
      ) = 'jsonb' as "blobContentKeyTargetsMetadataJsonb",
      (
        select data_type
        from information_schema.columns
        where table_name = 'blob_content_write_headers'
          and column_name = 'header'
      ) = 'jsonb' as "blobContentWriteHeadersHeaderJsonb"
  `);

  expect(result.rows[0]).toEqual({
    accessEvents: true,
    accessManifests: true,
    accessManifestHeads: true,
    containerKeyEpochs: true,
    containerKeyWraps: true,
    accessEventDependencyProjection: true,
    accessManifestDocumentLinkProjection: true,
    accessManifestPrincipalHeadProjection: true,
    documentContentKeyEpochs: true,
    documentContentKeyTargets: true,
    documentContentWriteHeaders: true,
    blobContentKeyEpochs: true,
    blobContentKeyTargets: true,
    blobContentWriteHeaders: true,
    accessEventsEventHashIndex: true,
    accessManifestsObjectEpochIndex: true,
    accessManifestHeadsObjectIndex: true,
    containerKeyEpochsContainerEpochIndex: true,
    containerKeyWrapsEpochRecipientIndex: true,
    accessManifestDocumentLinkUniqueIndex: true,
    documentContentKeyEpochsDocumentEpochIndex: true,
    documentContentKeyTargetsEpochContainerIndex: true,
    documentContentWriteHeadersHeaderHashIndex: true,
    documentContentWriteHeadersContentRecordIndex: true,
    documentContentWriteHeadersNonceDomainIndex: true,
    blobContentKeyEpochsBlobEpochIndex: true,
    blobContentKeyTargetsEpochBindingContainerIndex: true,
    blobContentWriteHeadersHeaderHashIndex: true,
    blobContentWriteHeadersContentRecordIndex: true,
    blobContentWriteHeadersNonceDomainIndex: true,
    accessEventsDependenciesJsonb: true,
    accessEventsBodyJsonb: true,
    accessManifestsPrincipalHeadsJsonb: true,
    documentContentKeyTargetsMetadataJsonb: true,
    documentContentWriteHeadersHeaderJsonb: true,
    blobContentKeyTargetsMetadataJsonb: true,
    blobContentWriteHeadersHeaderJsonb: true,
  });
});

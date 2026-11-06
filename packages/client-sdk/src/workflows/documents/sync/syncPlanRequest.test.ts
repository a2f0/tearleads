import { expect, test } from "bun:test";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  verifyWriteHeader,
  type WriteHeader,
} from "@tearleads/crypto";
import { isDocumentSyncRequest } from "@tearleads/validators/request";
import {
  createDeepNonCanonicalRecord,
  createPreparedUpdate,
  createSyncFixture,
  projectionPathRefs,
} from "../../../../test/helpers/documentFixtures";
import { buildDocumentSyncPlan } from "../syncPlan/syncPlanIdentity";

test("buildDocumentSyncPlan signs document write headers with the current access boundary", async () => {
  const { author, createResponse, projection, signingPublicKey } =
    await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    authorizingContainerPathRefs: [projectionPathRefs(projection)],
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    localVersionVector: null,
    minLsn: "0/16B6C50",
    outgoingUpdates: [
      await createPreparedUpdate({
        checkpointKind: "rotate_baseline",
        signedAt: "2026-04-27T00:00:01.000Z",
      }),
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  // The server resolves the signed manifest bundle by hash.
  expect(plan.request.expectedLinkSetManifestHash).toBe(
    createResponse.accessManifest.manifestHash,
  );
  expect(plan.request.contentKeyBundle?.targetHash).toBe(
    createResponse.contentKeyBundle.targetHash,
  );
  expect(
    plan.request.authorizingContainerPathRefs?.[0]?.[0]?.manifestHash,
  ).toBe(projection.path[0]?.manifestHash);
  const update = plan.request.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected a signed outgoing update");
  }
  const writeHeader = update.writeHeader as unknown as WriteHeader;
  expect(writeHeader.objectKind).toBe("document");
  expect(writeHeader.objectId).toBe(plan.documentId);
  expect(writeHeader.organizationId).toBe(author.organizationId);
  expect(writeHeader.accessManifestHash).toBe(
    createResponse.accessManifest.manifestHash,
  );
  expect(writeHeader.targetHash).toBe(
    createResponse.contentKeyBundle.targetHash,
  );
  expect(writeHeader.encryptionSuite).toBe(CONTENT_RECORD_ENCRYPTION_SUITE);

  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: createResponse.accessManifest.manifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: plan.documentId,
      organizationId: author.organizationId,
    },
    expectedTargetHash: createResponse.contentKeyBundle.targetHash,
    header: writeHeader,
    writerPublicKey: signingPublicKey,
  });
  expect(verified.ok).toBe(true);
});

test("buildDocumentSyncPlan omits write-only fields for read-only syncs", async () => {
  const { author, createResponse } = await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    localVersionVector: "{}",
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.outgoingUpdates).toEqual([]);
  expect(plan.request.historyMode).toBeUndefined();
  expect(plan.request.authorizingContainerPathRefs).toBeUndefined();
  expect(plan.request.contentKeyBundle).toBeUndefined();
});

test("buildDocumentSyncPlan creates a read-only resumed pull", async () => {
  const { author, createResponse } = await createSyncFixture();
  const plan = await buildDocumentSyncPlan({
    author,
    contentKeyBundle: createResponse.contentKeyBundle,
    documentKekTargets: createResponse.documentKekTargets,
    documentManifest: createResponse.accessManifest,
    localVersionVector: null,
    pullCursor: "resume-page-2",
  });

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  expect(plan.request.pullCursor).toBe("resume-page-2");
  expect(plan.request.outgoingUpdates).toEqual([]);
  expect(plan.request.authorizingContainerPathRefs).toBeUndefined();
  expect(plan.request.contentKeyBundle).toBeUndefined();
});

test("buildDocumentSyncPlan rejects manifest bundles whose state does not derive the manifest", async () => {
  const { author, createResponse, projection } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPathRefs: [projectionPathRefs(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: {
        ...createResponse.accessManifest,
        state: {
          ...createResponse.accessManifest.state,
          linkedContainerIds: [projection.containerId, "forged-container-link"],
        },
      },
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("manifest state mismatch");
});

test("buildDocumentSyncPlan rejects malformed manifest event envelopes before hashing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();
  const event = Reflect.get(createResponse.accessManifest.event, "event");
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Expected signed event fixture");
  }

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPathRefs: [projectionPathRefs(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: {
        ...createResponse.accessManifest,
        event: {
          ...createResponse.accessManifest.event,
          event: {
            ...(event as Record<string, unknown>),
            eventType: "document.move",
          },
        },
      },
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("signed event.eventType is invalid");
});

test("buildDocumentSyncPlan rejects deeply nested non-canonical manifest records without overflowing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPathRefs: [projectionPathRefs(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: {
        ...createResponse.accessManifest,
        event: {
          ...createResponse.accessManifest.event,
          event: {
            ...(Reflect.get(
              createResponse.accessManifest.event,
              "event",
            ) as Record<string, unknown>),
            unexpectedDeepValue: createDeepNonCanonicalRecord(20_000),
          },
        },
      },
      localVersionVector: null,
      outgoingUpdates: [await createPreparedUpdate()],
    }),
  ).rejects.toThrow("must be canonical JSON");
});

test("buildDocumentSyncPlan rejects duplicate content record domains before signing", async () => {
  const { author, createResponse, projection } = await createSyncFixture();
  const duplicateContentRecordId = "550e8400-e29b-41d4-a716-446655440333";

  await expect(
    buildDocumentSyncPlan({
      author,
      authorizingContainerPathRefs: [projectionPathRefs(projection)],
      contentKeyBundle: createResponse.contentKeyBundle,
      documentKekTargets: createResponse.documentKekTargets,
      documentManifest: createResponse.accessManifest,
      localVersionVector: null,
      outgoingUpdates: [
        await createPreparedUpdate({
          contentRecordId: duplicateContentRecordId,
          id: "550e8400-e29b-41d4-a716-446655440222",
        }),
        await createPreparedUpdate({
          contentRecordId: duplicateContentRecordId.toUpperCase(),
          id: "550e8400-e29b-41d4-a716-446655440223",
        }),
      ],
    }),
  ).rejects.toThrow("content record id is duplicated");
});

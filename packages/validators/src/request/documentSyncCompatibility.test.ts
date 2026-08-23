import { expect, test } from "bun:test";
import { createContainerMutation } from "../operation/openApiTestFixtures";
import {
  DocumentSyncResponseSchema,
  isDocumentSyncResponse,
} from "../response";
import { DocumentSyncRequestSchema, isDocumentSyncRequest } from "./index";

const UPDATE_ID = "550e8400-e29b-41d4-a716-446655440111";
function createSyncRequest() {
  return {
    authorizingContainerPathRefs: [
      [{ containerId: "container-1", manifestHash: "container-manifest-hash" }],
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: "document-link-set-hash",
      targetHash: "target-hash",
      targets: [
        {
          containerId: "container-1",
          containerKeyEpoch: 1,
          containerKeyEpochId: "container-key-epoch-id",
          containerManifestHash: "container-manifest-hash",
          wrappedKey: "wrapped-key",
          wrappingMetadata: { algorithm: "test" },
        },
      ],
    },
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: null,
    minLsn: "0/16B6C50",
    outgoingUpdates: [
      {
        encryptedData: "ciphertext",
        id: UPDATE_ID,
        partialEndVersionVector: '{"actor":1}',
        partialStartVersionVector: "{}",
        plaintextHash: "plaintext-hash",
        writeHeader: { updateId: UPDATE_ID },
      },
    ],
  };
}
function createContentKeyBundleResponse() {
  return {
    contentKeyEpoch: 1,
    documentId: "document-1",
    linkSetManifestHash: "document-link-set-hash",
    targetHash: "target-hash",
    targets: [
      {
        containerId: "container-1",
        containerKeyEpoch: 1,
        containerKeyEpochId: "container-key-epoch-id",
        containerManifestHash: "container-manifest-hash",
        wrappedKey: "wrapped-key",
        wrappingMetadata: { algorithm: "test" },
      },
    ],
  };
}
function createKekTargetsResponse() {
  return {
    documentId: "document-1",
    documentKeyTargetHash: "document-key-target-hash",
    linkedContainerKeyEpochIds: ["container-key-epoch-id"],
    linkedContainerManifestHashes: ["container-manifest-hash"],
    linkSetManifestHash: "document-link-set-hash",
    targets: [{ containerId: "container-1" }],
  };
}

function createSyncResponse() {
  return {
    acceptedOutgoingUpdateIds: [UPDATE_ID],
    commitLsn: null,
    contentKeyBundle: createContentKeyBundleResponse(),
    contentKeyBundles: [createContentKeyBundleResponse()],
    documentId: "document-1",
    documentKekTargets: createKekTargetsResponse(),
    updates: [
      {
        accessEpoch: 1,
        authorFingerprint: "author-fingerprint",
        createdAt: "2026-07-17T00:00:00.000Z",
        documentId: "document-1",
        encryptedData: "ciphertext",
        id: UPDATE_ID,
        partialEndVersionVector: '{"actor":1}',
        partialStartVersionVector: "{}",
        plaintextHash: "plaintext-hash",
        writeHeader: { updateId: UPDATE_ID },
      },
    ],
  };
}

function withNullPrototype(value: Record<string, unknown>) {
  return Object.assign(Object.create(null) as Record<string, unknown>, value);
}

test("document sync request guard preserves permissive envelope behavior", () => {
  const valid = createSyncRequest();
  const classEnvelope = Object.assign(new (class SyncRequest {})(), valid);

  expect(isDocumentSyncRequest({ ...valid, futureField: true })).toBe(true);
  expect(
    isDocumentSyncRequest({
      ...valid,
      outgoingUpdates: [{ ...valid.outgoingUpdates[0], futureField: true }],
    }),
  ).toBe(true);
  expect(isDocumentSyncRequest(withNullPrototype(valid))).toBe(true);
  expect(isDocumentSyncRequest({ ...valid, localVersionVector: "" })).toBe(
    true,
  );
  expect(
    isDocumentSyncRequest({ ...valid, authorizingContainerPathRefs: [] }),
  ).toBe(true);
  expect(
    isDocumentSyncRequest({
      ...valid,
      contentKeyBundle: { ...valid.contentKeyBundle, targets: [] },
    }),
  ).toBe(true);
  expect(isDocumentSyncRequest({ ...valid, minLsn: undefined })).toBe(true);
  expect(
    isDocumentSyncRequest({ ...valid, supportsUntrackedCommitLsn: true }),
  ).toBe(true);
  expect(
    isDocumentSyncRequest({ ...valid, supportsUntrackedCommitLsn: false }),
  ).toBe(false);
  expect(isDocumentSyncRequest(classEnvelope)).toBe(false);
});

test("document sync request guard preserves cross-field rules", () => {
  const valid = createSyncRequest();
  const update = valid.outgoingUpdates[0];
  const incompleteCheckpointRequest = {
    ...valid,
    outgoingUpdates: [
      { ...update, checkpointKind: "rotate_baseline" as const },
    ],
  };

  expect(isDocumentSyncRequest({})).toBe(false);
  expect(isDocumentSyncRequest({ outgoingUpdates: "invalid" })).toBe(false);

  expect(
    isDocumentSyncRequest({
      ...valid,
      outgoingUpdates: [
        {
          ...update,
          checkpointKind: "rotate_baseline",
          checkpointPayloadKind: "full_history_snapshot",
          sourceVersionVector: '{"actor":1}',
        },
      ],
    }),
  ).toBe(true);
  expect(isDocumentSyncRequest(incompleteCheckpointRequest)).toBe(false);
  const incompleteCheckpointResult = DocumentSyncRequestSchema.safeParse(
    incompleteCheckpointRequest,
  );
  expect(incompleteCheckpointResult.success).toBe(false);
  if (!incompleteCheckpointResult.success) {
    expect(incompleteCheckpointResult.error.issues).toEqual([
      {
        code: "custom",
        message: "checkpoint fields must be absent or form a rotation baseline",
        path: ["outgoingUpdates", 0],
      },
    ]);
  }
  expect(
    isDocumentSyncRequest({
      ...valid,
      authorizingContainerPathRefs: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...valid,
      outgoingUpdates: [update, update],
    }),
  ).toBe(false);
  expect(isDocumentSyncRequest({ ...valid, minLsn: "not-an-lsn" })).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...valid,
      authorizingContainerPathRefs: [[]],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...valid,
      contentKeyEpoch: Number.MAX_SAFE_INTEGER + 1,
      minLsn: "FFFFFFFF/FFFFFFFF",
    }),
  ).toBe(true);
  expect(
    isDocumentSyncRequest({ ...valid, contentKeyEpoch: Number.MAX_VALUE }),
  ).toBe(true);
  expect(isDocumentSyncRequest({ ...valid, contentKeyEpoch: 1e-10 })).toBe(
    false,
  );
  expect(
    isDocumentSyncRequest({
      ...valid,
      outgoingUpdates: [{ ...update, id: UPDATE_ID.toUpperCase() }],
    }),
  ).toBe(false);
  expect(isDocumentSyncRequest({ ...valid, minLsn: "100000000/0" })).toBe(
    false,
  );
  expect(
    isDocumentSyncRequest({
      ...valid,
      localVersionVector: undefined,
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...valid,
      outgoingUpdates: [{ ...update, writeHeader: {} }],
    }),
  ).toBe(true);
  expect(
    isDocumentSyncRequest({
      ...valid,
      authorizingContainerPathRefs: undefined,
      outgoingUpdates: [],
    }),
  ).toBe(true);
  expect(
    isDocumentSyncRequest({
      ...valid,
      authorizingContainerPathRefs: [new Array(1)],
      contentKeyBundle: {
        ...valid.contentKeyBundle,
        targets: new Array(1),
      },
    }),
  ).toBe(true);
  expect(
    isDocumentSyncRequest({ ...valid, outgoingUpdates: new Array(1) }),
  ).toBe(false);
});

test("document sync request mode preserves issue mapping", () => {
  const valid = createSyncRequest();
  const update = valid.outgoingUpdates[0];

  const missingPathsResult = DocumentSyncRequestSchema.safeParse({
    ...valid,
    authorizingContainerPathRefs: undefined,
    outgoingUpdates: [update, update],
  });
  expect(missingPathsResult.success).toBe(false);
  if (!missingPathsResult.success) {
    expect(missingPathsResult.error.issues).toEqual([
      {
        code: "custom",
        message:
          "authorizing container paths are required for outgoing updates",
        path: ["authorizingContainerPathRefs"],
      },
      {
        code: "custom",
        message: "outgoing update ids must be unique",
        path: ["outgoingUpdates"],
      },
    ]);
  }

  const rekeysWithoutWriteResult = DocumentSyncRequestSchema.safeParse({
    ...valid,
    containerRekeys: [createContainerMutation()],
    outgoingUpdates: [],
  });
  expect(rekeysWithoutWriteResult.success).toBe(false);
  if (!rekeysWithoutWriteResult.success) {
    expect(rekeysWithoutWriteResult.error.issues).toEqual([
      {
        code: "custom",
        message: "container rekeys require an outgoing update",
        path: ["containerRekeys"],
      },
    ]);
  }

  const malformedRekeysResult = DocumentSyncRequestSchema.safeParse({
    ...valid,
    containerRekeys: "invalid",
    outgoingUpdates: [],
  });
  expect(malformedRekeysResult.success).toBe(false);
  if (!malformedRekeysResult.success) {
    expect(malformedRekeysResult.error.issues).toEqual([
      {
        code: "custom",
        message: "Invalid input",
        path: ["containerRekeys"],
      },
      {
        code: "custom",
        message: "container rekeys require an outgoing update",
        path: ["containerRekeys"],
      },
    ]);
  }

  expect(
    DocumentSyncRequestSchema.safeParse({
      ...valid,
      authorizingContainerPathRefs: [],
      containerRekeys: [],
    }).success,
  ).toBe(true);
  expect(
    DocumentSyncRequestSchema.safeParse({
      ...valid,
      authorizingContainerPathRefs: undefined,
      containerRekeys: [],
      outgoingUpdates: [],
    }).success,
  ).toBe(true);
});

test("document sync request schema preserves signed and extension fields", () => {
  const valid = createSyncRequest();
  const writeHeader = valid.outgoingUpdates[0]?.writeHeader;
  const input = {
    ...valid,
    futureField: true,
    outgoingUpdates: [
      { ...valid.outgoingUpdates[0], futureUpdateField: "preserved" },
    ],
  };
  Object.defineProperty(input, "__proto__", {
    configurable: true,
    enumerable: true,
    value: { extensionField: "preserved" },
    writable: true,
  });
  const result = DocumentSyncRequestSchema.safeParse(input);

  expect(result.success).toBe(true);
  if (!result.success) {
    throw result.error;
  }

  expect(Object.is(result.data, input)).toBe(true);
  expect(Reflect.get(result.data, "futureField")).toBe(true);
  expect(Object.hasOwn(result.data, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
  expect(
    Reflect.get(result.data.outgoingUpdates[0] ?? {}, "futureUpdateField"),
  ).toBe("preserved");
  expect(result.data.outgoingUpdates[0]?.writeHeader).toBe(writeHeader);
});

test("document sync response guard preserves permissive envelope behavior", () => {
  const valid = createSyncResponse();
  const update = valid.updates[0];
  const classEnvelope = Object.assign(new (class SyncResponse {})(), valid);

  expect(isDocumentSyncResponse({ ...valid, futureField: true })).toBe(true);
  expect(
    isDocumentSyncResponse({
      ...valid,
      updates: [{ ...update, futureField: true }],
    }),
  ).toBe(true);
  expect(isDocumentSyncResponse(withNullPrototype(valid))).toBe(true);
  expect(
    isDocumentSyncResponse({
      ...valid,
      acceptedOutgoingUpdateIds: [""],
      commitLsn: "",
      contentKeyBundles: [],
      documentId: "",
      updates: [
        {
          ...update,
          authorFingerprint: "",
          createdAt: "",
          documentId: "",
          encryptedData: "",
          id: "",
          partialEndVersionVector: "",
          partialStartVersionVector: "",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isDocumentSyncResponse({
      ...valid,
      acceptedOutgoingUpdateIds: new Array(1),
      contentKeyBundles: new Array(1),
      updates: new Array(1),
    }),
  ).toBe(true);
  expect(isDocumentSyncResponse(classEnvelope)).toBe(false);
  expect(
    isDocumentSyncResponse({
      ...valid,
      updates: [{ ...update, accessEpoch: 1e-10 }],
    }),
  ).toBe(false);
});

test("document sync response guard preserves checkpoint rules", () => {
  const valid = createSyncResponse();
  const update = valid.updates[0];
  const incompleteCheckpointResponse = {
    ...valid,
    updates: [{ ...update, checkpointKind: "rotate_baseline" as const }],
  };

  expect(
    isDocumentSyncResponse({
      ...valid,
      updates: [
        {
          ...update,
          checkpointKind: "rotate_baseline",
          checkpointPayloadKind: "full_history_snapshot",
          sourceVersionVector: '{"actor":1}',
        },
      ],
    }),
  ).toBe(true);
  expect(isDocumentSyncResponse(incompleteCheckpointResponse)).toBe(false);
  const incompleteCheckpointResult = DocumentSyncResponseSchema.safeParse(
    incompleteCheckpointResponse,
  );
  expect(incompleteCheckpointResult.success).toBe(false);
  if (!incompleteCheckpointResult.success) {
    expect(incompleteCheckpointResult.error.issues).toEqual([
      {
        code: "custom",
        message: "checkpoint fields must be absent or form a rotation baseline",
        path: ["updates", 0],
      },
    ]);
  }
});

test("document sync response schema preserves signed and extension fields", () => {
  const valid = createSyncResponse();
  const writeHeader = valid.updates[0]?.writeHeader;
  const input = {
    ...valid,
    futureField: true,
    updates: [{ ...valid.updates[0], futureUpdateField: "preserved" }],
  };
  Object.defineProperty(input, "__proto__", {
    configurable: true,
    enumerable: true,
    value: { extensionField: "preserved" },
    writable: true,
  });
  const result = DocumentSyncResponseSchema.safeParse(input);

  expect(result.success).toBe(true);
  if (!result.success) {
    throw result.error;
  }

  expect(Object.is(result.data, input)).toBe(true);
  expect(Reflect.get(result.data, "futureField")).toBe(true);
  expect(Object.hasOwn(result.data, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
  expect(Reflect.get(result.data.updates[0] ?? {}, "futureUpdateField")).toBe(
    "preserved",
  );
  expect(result.data.updates[0]?.writeHeader).toBe(writeHeader);
});

test("document sync response pull page requires a consistent continuation", () => {
  const valid = createSyncResponse();
  const pullPage = {
    hasMore: true,
    nextCursor: "next-page",
  };
  expect(isDocumentSyncResponse({ ...valid, pullPage })).toBe(true);
  expect(
    isDocumentSyncResponse({
      ...valid,
      pullPage: { ...pullPage, hasMore: false },
    }),
  ).toBe(false);
});

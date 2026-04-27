import { expect, test } from "bun:test";
import {
  type AccessEventV2,
  generateSigningSeedAndKeyPair,
  type KeyingV2CanonicalJson,
  toFingerprint,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { isDocumentV2CreateRequest } from "@tearleads/validators/request";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2CreateResponse,
} from "@tearleads/validators/response";
import {
  buildDocumentV2CreatePlan,
  type DocumentV2CreateAuthor,
  type DocumentV2CreatePlan,
  deriveDocumentV2CreateTargets,
  persistedDocumentV2CreateStateFromResponse,
} from "./documentV2Runtime";

async function fixtureHash(label: string): Promise<string> {
  return toFingerprint(new TextEncoder().encode(`document-v2:${label}`));
}

async function createProjection(): Promise<ContainerV2WriterProjectionResponse> {
  const containerId = "container-1";
  const organizationId = "organization-1";
  const manifestHash = await fixtureHash("container-manifest");
  const keyEpochHash = await fixtureHash("container-key-epoch");
  const keyTargetHash = await fixtureHash("container-key-target");

  return {
    containerId,
    organizationId,
    path: [
      {
        event: {
          event: {},
          body: {},
          eventHash: await fixtureHash("container-event"),
        },
        manifest: {},
        manifestHash,
        state: {
          containerId,
          organizationId,
        },
      },
    ],
    containerKeks: [
      {
        containerId,
        accessManifestHash: manifestHash,
        containerKeyEpochId: "container-key-epoch-1",
        containerKeyEpoch: 1,
        keyEpoch: {},
        keyEpochHash,
        keyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: [{}],
        wraps: [{}],
      },
    ],
  };
}

async function createAuthor(): Promise<{
  author: DocumentV2CreateAuthor;
  signingPublicKey: Uint8Array;
}> {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signerKeyFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );

  return {
    author: {
      organizationId: "organization-1",
      signerDeviceId: "test-device-1",
      signerKeyFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      signerUserId: "user-1",
    },
    signingPublicKey: signingKeyPair.signingPublicKey,
  };
}

function createResponse(plan: DocumentV2CreatePlan): DocumentV2CreateResponse {
  return {
    id: plan.documentId,
    createdAt: "2026-04-27T00:00:00.000Z",
    accessManifest: {
      event: {
        event: plan.event as unknown as Record<string, unknown>,
        body: plan.body as unknown as Record<string, unknown>,
        eventHash: plan.eventHash,
      },
      manifest: plan.manifest as unknown as Record<string, unknown>,
      manifestHash: plan.manifestHash,
      state: plan.state as unknown as Record<string, unknown>,
    },
    contentKeyBundle: {
      documentId: plan.documentId,
      contentKeyEpoch: plan.request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: plan.request.contentKeyBundle.linkSetManifestHash,
      targetHash: plan.request.contentKeyBundle.targetHash,
      targets: plan.request.contentKeyBundle.targets,
    },
    documentKekTargets: {
      documentId: plan.documentId,
      linkSetManifestHash: plan.manifestHash,
      linkedContainerManifestHashes: plan.targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: plan.targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets: plan.targets.map((target) => ({
        ...target,
      })),
      documentKeyTargetHash: plan.targetHash,
    },
  };
}

function getOnlyTarget(
  projection: ContainerV2WriterProjectionResponse,
): ReturnType<typeof deriveDocumentV2CreateTargets>[number] {
  const target = deriveDocumentV2CreateTargets(projection)[0];
  if (!target) {
    throw new Error("Expected test projection to derive a document target");
  }
  return target;
}

test("buildDocumentV2CreatePlan signs an initial document link manifest from a container projection", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const plan = await buildDocumentV2CreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-1",
    eventId: "event-1",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetEnvelopes: [
      {
        ...target,
        wrappedKey: "wrapped-document-key",
        wrappingMetadata: {
          algorithm: "test-only",
        },
      },
    ],
  });

  expect(isDocumentV2CreateRequest(plan.request)).toBe(true);
  expect(plan.request.expectedManifestHash).toBe(plan.manifestHash);
  expect(plan.request.contentKeyBundle.linkSetManifestHash).toBe(
    plan.manifestHash,
  );
  expect(plan.request.contentKeyBundle.targetHash).toBe(plan.targetHash);
  const targetPathManifestHash = plan.request.targetContainerPath?.[0]
    ? Reflect.get(plan.request.targetContainerPath[0], "manifestHash")
    : undefined;
  expect(targetPathManifestHash).toBe(target.containerManifestHash);
  expect(plan.request.contentKeyBundle.targets).toEqual([
    {
      ...target,
      wrappedKey: "wrapped-document-key",
      wrappingMetadata: {
        algorithm: "test-only",
      },
    },
  ]);

  const verifiedEvent = await verifySignedAccessEvent({
    body: plan.body as unknown as KeyingV2CanonicalJson,
    event: plan.event as AccessEventV2,
    signerPublicKey: signingPublicKey,
  });
  expect(verifiedEvent.ok).toBe(true);
});

test("buildDocumentV2CreatePlan rejects missing or stale content-key target envelopes", async () => {
  const { author } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);

  await expect(
    buildDocumentV2CreatePlan({
      author,
      containerProjection: projection,
      documentId: "document-1",
      targetEnvelopes: [],
    }),
  ).rejects.toThrow("missing");

  await expect(
    buildDocumentV2CreatePlan({
      author,
      containerProjection: projection,
      documentId: "document-1",
      targetEnvelopes: [
        {
          ...target,
          containerManifestHash: await fixtureHash("stale-manifest"),
          wrappedKey: "wrapped-document-key",
          wrappingMetadata: {},
        },
      ],
    }),
  ).rejects.toThrow("unexpected");
});

test("persistedDocumentV2CreateStateFromResponse stores verified V2 create bundles", async () => {
  const { author } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const plan = await buildDocumentV2CreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-1",
    targetEnvelopes: [
      {
        ...target,
        wrappedKey: "wrapped-document-key",
        wrappingMetadata: {},
      },
    ],
  });
  const response = createResponse(plan);
  const tamperedTargetHash = await fixtureHash("tampered-target");

  expect(persistedDocumentV2CreateStateFromResponse(plan, response)).toEqual({
    documentId: "document-1",
    v2ContentKeyBundle: JSON.stringify(response.contentKeyBundle),
    v2DocumentKekTargets: JSON.stringify(response.documentKekTargets),
    v2DocumentManifestBundle: JSON.stringify(response.accessManifest),
  });

  expect(() =>
    persistedDocumentV2CreateStateFromResponse(plan, {
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targetHash: tamperedTargetHash,
      },
    }),
  ).toThrow("target hash mismatch");

  expect(() =>
    persistedDocumentV2CreateStateFromResponse(plan, {
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targets: [],
      },
    }),
  ).toThrow("content-key targets mismatch");
});

import { expect, test } from "bun:test";
import {
  type AccessEvent,
  type KeyingCanonicalJson,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { isDocumentCreateRequest } from "@tearleads/validators/request";
import {
  createAuthor,
  createProjection,
  fixtureHash,
  getOnlyTarget,
} from "../../../../test/helpers/documentFixtures";
import { buildDocumentCreatePlan } from "./events";

test("buildDocumentCreatePlan signs an initial document link manifest from a container projection", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const plan = await buildDocumentCreatePlan({
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

  expect(isDocumentCreateRequest(plan.request)).toBe(true);
  expect(plan.request.expectedManifestHash).toBe(plan.manifestHash);
  expect(plan.request.contentKeyBundle.linkSetManifestHash).toBe(
    plan.manifestHash,
  );
  expect(plan.request.contentKeyBundle.targetHash).toBe(plan.targetHash);
  const targetPathManifestHash =
    plan.request.targetContainerPathRefs?.[0]?.manifestHash;
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
    body: plan.body as unknown as KeyingCanonicalJson,
    event: plan.event as AccessEvent,
    signerPublicKey: signingPublicKey,
  });
  expect(verifiedEvent.ok).toBe(true);
});

test("buildDocumentCreatePlan rejects missing or stale content-key target envelopes", async () => {
  const { author } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);

  await expect(
    buildDocumentCreatePlan({
      author,
      containerProjection: projection,
      documentId: "document-1",
      targetEnvelopes: [],
    }),
  ).rejects.toThrow("missing");

  await expect(
    buildDocumentCreatePlan({
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

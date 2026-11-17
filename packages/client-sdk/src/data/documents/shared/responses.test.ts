import { expect, test } from "bun:test";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createProjection,
  createResponse,
  fixtureHash,
  getOnlyTarget,
} from "../../../../test/helpers/data/documentFixtures";
import { buildDocumentCreatePlan } from "./events";
import { persistedDocumentCreateStateFromResponse } from "./responses";

test("persistedDocumentCreateStateFromResponse stores verified create bundles", async () => {
  const { author } = await createAuthor();
  const projection = await createProjection();
  const target = getOnlyTarget(projection);
  const plan = await buildDocumentCreatePlan({
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
  const fixture = createResponse(plan);
  // The wire acknowledgement carries hashes only; the persisted state is the
  // plan the client signed, exactly as the old echo carried it.
  const response: DocumentCreateResponse = {
    contentKeyEpoch: fixture.contentKeyEpoch,
    createdAt: fixture.createdAt,
    eventHash: fixture.eventHash,
    id: fixture.id,
    manifestHash: fixture.manifestHash,
    targetHash: fixture.targetHash,
  };
  const persisted = persistedDocumentCreateStateFromResponse(plan, response);
  expect(persisted.documentId).toBe("document-1");
  expect(JSON.parse(persisted.contentKeyBundle ?? "")).toEqual(
    fixture.contentKeyBundle,
  );
  expect(JSON.parse(persisted.documentKekTargets ?? "")).toEqual(
    fixture.documentKekTargets,
  );
  expect(JSON.parse(persisted.documentManifestBundle ?? "")).toEqual(
    JSON.parse(JSON.stringify(fixture.accessManifest)),
  );

  const tampered = await fixtureHash("tampered");
  for (const [field, message] of [
    ["targetHash", "target hash mismatch"],
    ["manifestHash", "manifest hash mismatch"],
    ["eventHash", "manifest hash mismatch"],
    ["id", "id mismatch"],
  ] as const) {
    expect(() =>
      persistedDocumentCreateStateFromResponse(plan, {
        ...response,
        [field]: tampered,
      }),
    ).toThrow(message);
  }
  expect(() =>
    persistedDocumentCreateStateFromResponse(plan, {
      ...response,
      contentKeyEpoch: response.contentKeyEpoch + 1,
    }),
  ).toThrow("content-key epoch mismatch");
});

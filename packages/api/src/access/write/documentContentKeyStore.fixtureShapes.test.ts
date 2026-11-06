import { describe, expect, test } from "bun:test";
import {
  normalizeContainerAccessEventBody,
  normalizeDocumentAccessEventBody,
} from "@tearleads/crypto";
import {
  createVerifiedContainerManifest,
  createVerifiedDocumentLinkSetManifest,
} from "../../../test/helpers/documentContentKeyStoreFixtures";
import { hashOf } from "../../../test/helpers/keyingLabelHash";

// The store tests save these manifests directly, so no production verifier
// reads the signed bodies; this keeps the fixture on the production shapes.
describe("documentContentKeyStore fixtures", () => {
  test.each(["container.grant", "container.move", "container.rekey"] as const)(
    "sign %s bodies in production shape",
    async (eventType) => {
      const organizationId = crypto.randomUUID();
      const parent =
        eventType === "container.move"
          ? {
              parentContainerId: crypto.randomUUID(),
              parentManifestHash: await hashOf("fixture-shape:parent"),
            }
          : {};
      const container = await createVerifiedContainerManifest({
        containerId: crypto.randomUUID(),
        eventType,
        organizationId,
        salt: `fixture-shape:${eventType}`,
        ...parent,
      });
      const { body } = container.event;

      expect<unknown>(normalizeContainerAccessEventBody(body)).toEqual(body);
    },
  );

  test("sign document.link bodies in production shape", async () => {
    const document = await createVerifiedDocumentLinkSetManifest({
      containerManifestHashes: [await hashOf("fixture-shape:container")],
      documentId: crypto.randomUUID(),
      linkedContainerIds: [crypto.randomUUID()],
      organizationId: crypto.randomUUID(),
    });
    const { body } = document.event;

    expect<unknown>(normalizeDocumentAccessEventBody(body)).toEqual(body);
  });
});

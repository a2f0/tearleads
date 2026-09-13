import { expect, test } from "bun:test";
import {
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydration";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { assertBlobWrapScopeVerified } from "./verifiedWrapScope";

// A projection that has not served the wrap-cited container manifest is
// retryable proof material, not integrity evidence: the proof reader refreshes
// the projection and retries instead of hiding the attachment.
test("a wrap citing a manifest the projection lacks is an unavailable dependency", async () => {
  const fixture = await createUploadedAttachmentFixture();
  expect(() =>
    assertBlobWrapScopeVerified({
      authorization: {
        containerPathByManifestHash: new Map(),
        documentManifestByHash: new Map(),
        principalPolicies: [],
      },
      binding: createFixtureBinding(fixture),
      documentId: fixture.writerProjection.documentId,
    }),
  ).toThrow(ProjectionDependencyUnavailableError);
});

import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import { createUploadedAttachmentFixture } from "../../../test/helpers/blobHydration";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { prepareDocumentLinkBlobRewraps } from "./linkSetBlobRewraps";

// The API refuses a link unless every active binding is rewrapped, so a
// listing the API could not serve (offline, or a 409 while a bind is
// mid-flight) fails this mutation as a retryable dependency, not as integrity
// evidence and not as an anonymous error.
test("an unavailable attachment listing fails relinking as a retryable dependency", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const targetContainerProjection =
    fixture.writerProjection.authorizingContainerPaths[0];
  if (!targetContainerProjection) throw new Error("Expected container path");
  let listings = 0;
  await expect(
    prepareDocumentLinkBlobRewraps({
      apiClient: createMockApiClient({
        listDocumentAttachments: async () => {
          listings += 1;
          return null;
        },
      }),
      execSql: fixture.execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetContainerProjection,
      targetSecretKey: fixture.secretKey,
      targets: [],
      writerProjection: fixture.writerProjection,
    }),
  ).rejects.toBeInstanceOf(ProjectionDependencyUnavailableError);
  expect(listings).toBe(1);
});

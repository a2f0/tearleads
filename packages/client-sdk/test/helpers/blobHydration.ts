import { afterEach } from "bun:test";
import type { hydrateDocumentAttachmentBlobs } from "../../src/workflows/blobs/hydrate";
import {
  createUploadedAttachmentFixture as createFixture,
  createFixtureBinding,
} from "./blobHydrationFixture";

export {
  createBlobBytesResponse,
  createFixtureBinding,
} from "./blobHydrationFixture";

const closeTestDatabases: Array<() => void> = [];
afterEach(() => {
  closeTestDatabases.splice(0).forEach((close) => {
    close();
  });
});

export async function createUploadedAttachmentFixture() {
  const fixture = await createFixture();
  closeTestDatabases.push(fixture.close);
  return fixture;
}

type HydrationApi = Parameters<
  typeof hydrateDocumentAttachmentBlobs
>[0]["apiClient"];
export function createSingleAttachmentHydrationApi(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  getBlobBytes: HydrationApi["getBlobBytes"],
): HydrationApi {
  return {
    getBlobBytes,
    getDocumentWriterProjection: async () => fixture.writerProjection,
    listDocumentAttachments: async () => [createFixtureBinding(fixture)],
  };
}

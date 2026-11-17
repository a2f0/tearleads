import { afterEach } from "bun:test";
import type { DocumentAttachmentHydrationApi } from "../../../src/data/blobs/attachments/types";
import {
  createUploadedAttachmentFixture as createFixture,
  createFixtureBinding,
} from "./blobHydrationFixture";

export {
  createBlobBytesResponse,
  createFixtureBinding,
  stagedBindingSummary,
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

export function createSingleAttachmentHydrationApi(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  getBlobBytes: DocumentAttachmentHydrationApi["getBlobBytes"],
): DocumentAttachmentHydrationApi {
  return {
    getBlobBytes,
    getDocumentWriterProjection: async () => fixture.writerProjection,
    listDocumentAttachments: async () => [createFixtureBinding(fixture)],
  };
}

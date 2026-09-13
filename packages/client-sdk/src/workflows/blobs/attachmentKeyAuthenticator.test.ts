import { expect, spyOn, test } from "bun:test";
import { signWriteHeader } from "@tearleads/crypto";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydrationFixture";
import { deriveDocumentTargetFromProjection } from "../../data/documents/shared/projection";
import { readWriteHeader } from "../../data/documents/shared/readers";
import { prepareDocumentLinkBlobRewraps } from "../documents/linkSetBlobRewraps";
import { createAttachmentKeyAuthenticator } from "./attachmentKeyAuthenticator";

test("link rewrap authenticates multi-chunk bytes without buffering the response", async () => {
  const fixture = await createUploadedAttachmentFixture({
    bytes: new Uint8Array(10 * 1024 * 1024 + 3).fill(7),
  });
  const buffer = spyOn(Response.prototype, "arrayBuffer").mockImplementation(
    async () => {
      throw new Error("Relinking must not buffer an attachment response");
    },
  );
  try {
    const target = fixture.writerProjection.authorizingContainerPaths[0];
    if (!target) throw new Error("Expected target");
    const result = await prepareDocumentLinkBlobRewraps({
      apiClient: createMockApiClient({
        listDocumentAttachments: async () => [createFixtureBinding(fixture)],
        getBlobBytes: async () =>
          createBlobBytesResponse({
            blobId: fixture.blobId,
            ...fixture.stagedBlob,
          }),
        getDocumentWriterProjection: async () => fixture.writerProjection,
      }),
      execSql: fixture.execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetContainerProjection: target,
      targetSecretKey: fixture.secretKey,
      targets: [deriveDocumentTargetFromProjection(target)],
      writerProjection: fixture.writerProjection,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.targets[0]?.wrappedKey).toBe(
      fixture.uploaded.response.contentKeyBundle.targets[0]?.wrappedKey,
    );
    expect(buffer).not.toHaveBeenCalled();
  } finally {
    buffer.mockRestore();
    fixture.close();
  }
});

for (const failure of [
  "corrupt-tail",
  "truncated",
  "trailing",
  "signed-hash",
] as const) {
  test(`streamed key authentication refuses ${failure}`, async () => {
    const fixture = await createUploadedAttachmentFixture();
    try {
      const binding = createFixtureBinding(fixture);
      let encryptedBytes = fixture.stagedBlob.encryptedBytes.slice();
      if (failure === "corrupt-tail")
        encryptedBytes[encryptedBytes.length - 1] =
          (encryptedBytes.at(-1) ?? 0) ^ 1;
      if (failure === "truncated") encryptedBytes = encryptedBytes.slice(0, -1);
      if (failure === "trailing")
        encryptedBytes = new Uint8Array([...encryptedBytes, 0]);
      if (failure === "signed-hash") {
        const { signature: _signature, ...header } = readWriteHeader(
          binding.writeHeader,
          "header",
        );
        binding.writeHeader = {
          ...(await signWriteHeader(
            { ...header, ciphertextHash: "0".repeat(64) },
            fixture.author.signerPrivateKey,
          )),
        };
      }
      const authenticate = createAttachmentKeyAuthenticator(
        createMockApiClient({
          getBlobBytes: async () =>
            createBlobBytesResponse({
              blobId: fixture.blobId,
              ...fixture.stagedBlob,
              encryptedBytes,
            }),
        }),
        fixture.writerProjection.documentId,
      );
      await expect(
        authenticate({
          binding,
          expectedDocumentId: fixture.writerProjection.documentId,
          expectedSlotId: fixture.attachment.slotId,
          execSql: fixture.execSql,
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
          targetSecretKey: fixture.secretKey,
          writerProjection: fixture.writerProjection,
        }),
      ).rejects.toThrow();
    } finally {
      fixture.close();
    }
  });
}

test("cached blob keys retain ciphertext identity and verify each binding", async () => {
  const fixture = await createUploadedAttachmentFixture();
  try {
    const binding = createFixtureBinding(fixture);
    let downloads = 0;
    const authenticate = createAttachmentKeyAuthenticator(
      createMockApiClient({
        getBlobBytes: async () => {
          downloads++;
          return createBlobBytesResponse({
            blobId: fixture.blobId,
            ...fixture.stagedBlob,
          });
        },
      }),
      fixture.writerProjection.documentId,
    );
    const input = {
      binding,
      expectedDocumentId: fixture.writerProjection.documentId,
      expectedSlotId: fixture.attachment.slotId,
      execSql: fixture.execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    };
    expect(await authenticate(input)).toEqual(fixture.contentKey);
    expect(await authenticate(input)).toEqual(fixture.contentKey);
    const { signature: _signature, ...header } = readWriteHeader(
      binding.writeHeader,
      "header",
    );
    const changed = {
      ...binding,
      writeHeader: {
        ...(await signWriteHeader(
          { ...header, ciphertextHash: "0".repeat(64) },
          fixture.author.signerPrivateKey,
        )),
      },
    };
    await expect(authenticate({ ...input, binding: changed })).rejects.toThrow(
      "does not match ciphertext",
    );
    expect(downloads).toBe(1);
  } finally {
    fixture.close();
  }
});

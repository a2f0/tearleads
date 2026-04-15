import { afterAll, beforeAll, expect, test } from "bun:test";
import { encryptForRecipients, serializeBlobEnvelope } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import {
  commitDocumentChange,
  createDocument,
  stageBlob,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { createTestUser } from "../../../test/helpers/createTestUser";
import { registerUser } from "../../../test/helpers/registerUser";
import { del } from "../../adapters/redis";
import { routeApp } from "../../routeApp";

const alice = createTestUser();

beforeAll(async () => {
  await registerUser(alice);
  await authenticate(alice);
});

afterAll(async () => {
  await del(alice.fingerprint);
});

async function createStagedBlobInput(encryptedBytes: string) {
  const encodedBytes = new TextEncoder().encode(encryptedBytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encodedBytes),
  );

  return {
    encryptedBytes,
    byteLength: encodedBytes.byteLength,
    sha256: Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

async function createEncryptedBlobInput(
  plaintext: string,
  encodedRecipientPublicKeys: string[],
) {
  const envelope = await encryptForRecipients(
    new TextEncoder().encode(plaintext),
    encodedRecipientPublicKeys.map((publicKey) => base64ToBytes(publicKey)),
  );

  return createStagedBlobInput(serializeBlobEnvelope(envelope));
}

test("GET /blobs/:blobId returns committed encrypted blob bytes for readable blobs", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const stagedBlobInput = await createEncryptedBlobInput(
    "encrypted-image-bytes",
    createdDocument.recipientEncapsulationPublicKeys,
  );

  const stageResponse = await stageBlob(stagedBlobInput, alice.token);
  expect(stageResponse.status).toBe(200);
  const stage = await stageResponse.json();

  const commitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_image",
          stageId: stage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(commitResponse.status).toBe(200);
  const commitBody = await commitResponse.json();
  const blobId = String(commitBody.committedBindings[0]?.blobId ?? "");

  const blobResponse = await routeApp.request(`/blobs/${blobId}`, {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });

  expect(blobResponse.status).toBe(200);
  expect(await blobResponse.json()).toEqual({
    blobId,
    encryptedBytes: stagedBlobInput.encryptedBytes,
    sha256: stagedBlobInput.sha256,
  });
});

import { afterAll, beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { blobStages } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { stageBlob } from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { del } from "../../adapters/redis";

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

test("POST /blobs/stage rejects mismatched blob digests", async () => {
  const validInput = await createStagedBlobInput("ZW5jcnlwdGVkLWJ5dGVz");
  const response = await stageBlob(
    {
      encryptedBytes: validInput.encryptedBytes,
      byteLength: validInput.byteLength,
      sha256: "not-the-real-digest",
    },
    alice.token,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Blob sha256 does not match encryptedBytes",
  });
});

test("POST /blobs/stage stores a staged encrypted blob for the authenticated user", async () => {
  const response = await stageBlob(
    await createStagedBlobInput("ZW5jcnlwdGVkLWJ5dGVz"),
    alice.token,
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(typeof body.stageId).toBe("string");
  expect(typeof body.expiresAt).toBe("string");

  const [storedStage] = await db
    .select({
      id: blobStages.id,
      ownerUserId: blobStages.ownerUserId,
    })
    .from(blobStages)
    .where(eq(blobStages.id, body.stageId))
    .limit(1);

  expect(storedStage?.ownerUserId).toBe(alice.userId);
});

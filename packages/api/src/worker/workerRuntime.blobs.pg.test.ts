import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { createRegistrationRequestBody } from "../../test/helpers/api/submitRegistration";
import { type FakeS3, startFakeS3 } from "../../test/helpers/fakeS3";
import {
  attachWorkerLogs,
  databaseKind,
  expectJson,
  field,
  type LocalWorker,
  loginThroughWorker,
  postJson,
  START_TIMEOUT_MS,
  startLocalWorker,
  stringField,
} from "../../test/helpers/localWorker";

/**
 * The S3 transport in workerd against an S3 impostor: the multipart stage
 * lifecycle through the Worker (create, part, list, complete) decodes the
 * SDK's XML answers through the aliased parser, and the hourly Cron runs
 * blob garbage collection against the same store.
 */
describe.skipIf(databaseKind !== "postgres")("Worker runtime blobs", () => {
  let s3: FakeS3;
  let worker: LocalWorker;

  beforeAll(async () => {
    s3 = startFakeS3();
    worker = await startLocalWorker({
      BLOB_OBJECT_STORE: "s3",
      BLOB_OBJECT_STORE_S3_BUCKET: "fake",
      BLOB_OBJECT_STORE_S3_REGION: "us-east-1",
      BLOB_OBJECT_STORE_S3_ENDPOINT: s3.endpoint,
      BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE: "true",
      BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: "fake-key",
      BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY: "fake-secret",
    });
    attachWorkerLogs(worker.logs);
  }, START_TIMEOUT_MS + 10_000);

  afterAll(async () => {
    await worker?.stop();
    s3?.stop();
  });

  test("stages, uploads, lists, and completes a multipart blob, then collects garbage", async () => {
    const base = worker.origin;
    const user = createTestUser();
    const registration = await expectJson(
      await postJson(
        `${base}/auth/register`,
        await createRegistrationRequestBody(
          user.signing.signingPublicKey,
          user.signing.signingPrivateKey,
          user.kem.publicKey,
          { includeTrashSystemContainer: true },
        ),
      ),
      200,
    );
    const authorized = {
      authorization: `Bearer ${await loginThroughWorker(base, user)}`,
    };
    const bytes = crypto.getRandomValues(new Uint8Array(128 * 1024));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    const initiated = await expectJson(
      await postJson(
        `${base}/blobs/stages/multipart`,
        {
          organizationId: stringField(registration, "organizationId"),
          byteLength: bytes.byteLength,
          sha256,
        },
        authorized,
      ),
      200,
    );
    const stageId = stringField(initiated, "stageId");
    const uploadId = stringField(initiated, "uploadId");

    const uploaded = await expectJson(
      await fetch(`${base}/blobs/stages/multipart/${stageId}/parts/1/bytes`, {
        method: "PUT",
        headers: {
          ...authorized,
          "content-type": "application/octet-stream",
          "x-tearleads-blob-part-byte-length": String(bytes.byteLength),
          "x-tearleads-blob-part-sha256": sha256,
          "x-tearleads-blob-upload-id": uploadId,
        },
        body: bytes,
      }),
      200,
    );
    const part = field(uploaded, "part");
    expect(part).toMatchObject({ partNumber: 1 });

    // Stage status lists the parts S3 holds: XML decoded in the Worker.
    const status = await expectJson(
      await fetch(`${base}/blobs/stages/multipart/${stageId}`, {
        headers: authorized,
      }),
      200,
    );
    expect(field(status, "uploadedParts")).toMatchObject([{ partNumber: 1 }]);

    await expectJson(
      await postJson(
        `${base}/blobs/stages/multipart/${stageId}/complete`,
        {
          uploadId,
          parts: [
            {
              etag: stringField(
                typeof part === "object" && part !== null ? { ...part } : {},
                "etag",
              ),
              partNumber: 1,
            },
          ],
        },
        authorized,
      ),
      200,
    );
    expect(
      [...s3.objects().values()].map((object) => object.byteLength),
    ).toEqual([bytes.byteLength]);
    // Create, part, list, complete, then the completed object read back.
    expect(s3.requests()).toEqual([
      expect.stringMatching(/^POST .*\?uploads$/),
      expect.stringMatching(/^PUT .*\?uploadId&partNumber$/),
      expect.stringMatching(/^GET .*\?uploadId$/),
      expect.stringMatching(/^POST .*\?uploadId$/),
      expect.stringMatching(/^GET \/fake\/[^?]+$/),
    ]);

    // The hourly Cron runs blob garbage collection against the same store.
    const scheduled = await fetch(
      `${base}/__scheduled?cron=${encodeURIComponent("0 * * * *")}`,
    );
    expect(`${scheduled.status} ${await scheduled.text()}`).toBe(
      "200 Ran scheduled event",
    );
  }, 120_000);
});

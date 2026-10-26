import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createTestUser } from "@tearleads/test-utils";
import { InitiateMultipartBlobStageResponseSchema } from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import { buildBind } from "../../test/helpers/blobAttachmentKit";
import { createBlobEnvelopeFixture } from "../../test/helpers/blobEnvelope";
import { type FakeS3, startFakeS3 } from "../../test/helpers/fakeS3";
import {
  bootstrapRoot,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
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
} from "../../test/helpers/localWorker";
import { getDefaultOrganizationId } from "../../test/helpers/organizationMembership";
import { registerUser } from "../../test/helpers/registerUser";
import { sha256Hex } from "../utils/sha256";

/**
 * The S3 transport in workerd against an S3 impostor: the multipart stage
 * lifecycle through the Worker (create with its first part's signed URL,
 * part, list, then the attachment bind that completes the stage) decodes the
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

  test("stages, uploads, lists, and binds a multipart blob, then collects garbage", async () => {
    const base = worker.origin;
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const document = await createDocument({ owner, root });
    const organizationId = await getDefaultOrganizationId(owner.userId);
    const authorized = {
      authorization: `Bearer ${await loginThroughWorker(base, owner)}`,
    };
    const blobId = crypto.randomUUID();
    const { bytes } = await createBlobEnvelopeFixture({
      blobId,
      organizationId,
    });
    const sha256 = sha256Hex(bytes);
    const contentMd5 = createHash("md5").update(bytes).digest("base64");

    // The stage's first part arrives with its signed URL: no separate
    // authorization request.
    const initiated = InitiateMultipartBlobStageResponseSchema.parse(
      await expectJson(
        await postJson(
          `${base}/blobs/stages/multipart`,
          {
            organizationId,
            byteLength: bytes.byteLength,
            firstParts: [
              { byteLength: bytes.byteLength, contentMd5, partNumber: 1 },
            ],
            sha256,
          },
          authorized,
        ),
        200,
      ),
    );
    const [firstPart] = initiated.partUploads;
    if (firstPart?.source.kind !== "signed-url")
      throw new Error("Expected a direct upload URL");
    expect(
      new URL(firstPart.source.url).searchParams.get("X-Amz-SignedHeaders"),
    ).toBe("content-length;content-md5;host");
    const uploaded = await fetch(firstPart.source.url, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-md5": contentMd5,
      },
      body: new File([bytes], "encrypted-part"),
    });
    expect(uploaded.status).toBe(200);

    // Stage status lists the parts S3 holds: XML decoded in the Worker.
    const status = await expectJson(
      await fetch(`${base}/blobs/stages/multipart/${initiated.stageId}`, {
        headers: authorized,
      }),
      200,
    );
    expect(field(status, "uploadedParts")).toMatchObject([{ partNumber: 1 }]);

    // The bind completes the stage: list, complete, and one readback that
    // both digests the object and parses its envelope header.
    const { request } = await buildBind({
      blobId,
      document,
      owner,
      root,
      stagedBlob: { sha256, stageId: initiated.stageId },
    });
    await expectJson(
      await postJson(
        `${base}/blobs/${blobId}/attachment-bindings`,
        request,
        authorized,
      ),
      200,
    );
    expect(
      [...s3.objects().values()].map((object) => object.byteLength),
    ).toEqual([bytes.byteLength]);
    expect(s3.requests()).toEqual([
      expect.stringMatching(/^POST .*\?uploads$/),
      expect.stringMatching(/^PUT .*\?uploadId&partNumber$/),
      expect.stringMatching(/^GET .*\?uploadId$/),
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

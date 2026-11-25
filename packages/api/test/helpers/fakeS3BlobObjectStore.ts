import { expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import type {
  BlobObjectPart,
  BlobObjectStore,
} from "../../src/adapters/blobObjectStore";
import { createS3BlobObjectStore } from "../../src/adapters/s3BlobObjectStore";

export interface CommandWithInput {
  readonly input: S3CommandInput;
}

interface S3CommandInput {
  readonly Body?: unknown;
  readonly ChecksumAlgorithm?: unknown;
  readonly ChecksumSHA256?: unknown;
  readonly ChecksumType?: unknown;
  readonly ContentLength?: unknown;
  readonly ContentMD5?: unknown;
  readonly Key?: unknown;
  readonly MultipartUpload?: unknown;
  readonly MpuObjectSize?: unknown;
  readonly PartNumber?: unknown;
  readonly PartNumberMarker?: unknown;
  readonly UploadId?: unknown;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function concatenateBytes(
  chunks: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(
    chunks.reduce((byteLength, chunk) => byteLength + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function bodyToBytes(body: unknown): Promise<Uint8Array<ArrayBuffer>> {
  if (body instanceof Uint8Array) {
    return copyBytes(body);
  }
  if (body instanceof ReadableStream) {
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  if (isAsyncIterable(body)) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
      if (chunk instanceof Uint8Array) {
        chunks.push(copyBytes(chunk));
      } else {
        throw new Error("Unsupported test S3 body chunk");
      }
    }

    return concatenateBytes(chunks);
  }

  throw new Error("Unsupported test S3 body");
}

class FakeS3Client {
  readonly commands: unknown[] = [];
  readonly objectBodies = new Map<string, unknown>();
  readonly objects = new Map<string, Uint8Array<ArrayBuffer>>();
  readonly uploads = new Map<
    string,
    {
      readonly key: string;
      readonly parts: Map<
        number,
        { readonly bytes: Uint8Array<ArrayBuffer>; readonly etag: string }
      >;
    }
  >();

  listPartsPageSize = Number.POSITIVE_INFINITY;
  private nextUploadId = 1;

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    const input = (command as CommandWithInput).input;
    if (command instanceof CreateMultipartUploadCommand) {
      // No checksum algorithm is declared at create time; declaring one would
      // force every part checksum to be echoed on completion.
      expect(input.ChecksumAlgorithm).toBeUndefined();
      expect(input.ChecksumType).toBeUndefined();
      const uploadId = `upload-${this.nextUploadId}`;
      this.nextUploadId += 1;
      this.uploads.set(uploadId, {
        key: String(input.Key),
        parts: new Map(),
      });

      return { UploadId: uploadId };
    }
    if (command instanceof UploadPartCommand) {
      const upload = this.requireUpload(input);
      const partNumber = Number(input.PartNumber);
      const bytes = await bodyToBytes(input.Body);
      expect(input.ChecksumAlgorithm).toBeUndefined();
      expect(input.ChecksumSHA256).toBeUndefined();
      expect(input.ContentMD5).toBe(
        createHash("md5").update(bytes).digest("base64"),
      );
      expect(input.ContentLength).toBe(bytes.byteLength);
      const etag = `"etag-${partNumber}"`;
      upload.parts.set(partNumber, {
        bytes,
        etag,
      });

      return { ETag: etag };
    }
    if (command instanceof ListPartsCommand) {
      const upload = this.requireUpload(input);
      const marker = Number(input.PartNumberMarker ?? 0);
      const parts = [...upload.parts.entries()]
        .filter(([partNumber]) => partNumber > marker)
        .sort(([left], [right]) => left - right)
        .slice(0, this.listPartsPageSize);
      const lastPart = parts.at(-1);
      return {
        IsTruncated:
          lastPart !== undefined &&
          [...upload.parts.keys()].some(
            (partNumber) => partNumber > lastPart[0],
          ),
        NextPartNumberMarker:
          lastPart === undefined ? undefined : String(lastPart[0]),
        Parts: parts.map(([partNumber, part]) => ({
          ETag: part.etag,
          PartNumber: partNumber,
          Size: part.bytes.byteLength,
        })),
      };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      const upload = this.requireUpload(input);
      // R2 completion: validate by part ETag only. The
      // proprietary FULL_OBJECT whole-object checksum + MpuObjectSize flow is
      // not used; per-part integrity was already validated at upload time.
      const parts =
        (
          input.MultipartUpload as {
            readonly Parts?: readonly {
              readonly ETag?: string;
              readonly PartNumber?: number;
            }[];
          }
        ).Parts ?? [];
      const bytes = concatenateBytes(
        parts.map((part) => {
          const storedPart = upload.parts.get(Number(part.PartNumber));
          if (!storedPart || storedPart.etag !== part.ETag) {
            throw Object.assign(new Error("InvalidPart"), {
              name: "InvalidPart",
            });
          }

          return storedPart.bytes;
        }),
      );
      this.objects.set(upload.key, bytes);
      this.uploads.delete(String(input.UploadId));

      return {};
    }
    if (command instanceof GetObjectCommand) {
      const key = String(input.Key);
      const body = this.objectBodies.get(key);
      if (body !== undefined) {
        return { Body: body };
      }

      const bytes = this.objects.get(key);
      if (bytes === undefined) {
        throw Object.assign(new Error("NoSuchKey"), {
          $metadata: { httpStatusCode: 404 },
          name: "NoSuchKey",
        });
      }

      return { Body: new Blob([bytes]) };
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(String(input.Key));

      return {};
    }
    if (command instanceof AbortMultipartUploadCommand) {
      this.uploads.delete(String(input.UploadId));

      return {};
    }

    throw new Error(
      `Unexpected S3 command ${command instanceof Object ? command.constructor.name : String(command)}`,
    );
  }

  private requireUpload(input: S3CommandInput) {
    const upload = this.uploads.get(String(input.UploadId));
    if (!upload || upload.key !== input.Key) {
      throw Object.assign(new Error("NoSuchUpload"), {
        $metadata: { httpStatusCode: 404 },
        name: "NoSuchUpload",
      });
    }

    return upload;
  }
}

const FAKE_SIGNED_ORIGIN = "https://signed-part.test";

/**
 * A store shaped like the deployed one: S3 operations plus upload signing, so
 * part bytes reach the fake bucket the way a client sends them, never through
 * the API. `putSignedPart` plays the client's PUT and, like R2, refuses bytes
 * whose length or MD5 differs from what the URL signed.
 */
export function createFakeS3BlobObjectStore() {
  const client = new FakeS3Client();
  const bucket = "blob-test-bucket";
  const store: BlobObjectStore = {
    ...createS3BlobObjectStore({
      bucket,
      client: client as unknown as Pick<S3Client, "send">,
    }),
    async createUploadPartUrl(input) {
      const url = new URL(
        `/${encodeURIComponent(input.key)}`,
        FAKE_SIGNED_ORIGIN,
      );
      url.searchParams.set("uploadId", input.uploadId);
      url.searchParams.set("partNumber", String(input.partNumber));
      url.searchParams.set("byteLength", String(input.byteLength));
      url.searchParams.set("contentMd5", input.contentMd5);
      return {
        url: url.href,
        expiresAt: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
      };
    },
  };

  async function putSignedPart(
    signedUrl: string,
    bytes: Uint8Array,
  ): Promise<BlobObjectPart> {
    const url = new URL(signedUrl);
    const contentMd5 = createHash("md5").update(bytes).digest("base64");
    if (
      url.origin !== FAKE_SIGNED_ORIGIN ||
      url.searchParams.get("byteLength") !== String(bytes.byteLength) ||
      url.searchParams.get("contentMd5") !== contentMd5
    ) {
      throw new Error("Part bytes do not match the signed upload");
    }
    const partNumber = Number(url.searchParams.get("partNumber"));
    const { ETag } = (await client.send(
      new UploadPartCommand({
        Body: bytes,
        Bucket: bucket,
        ContentLength: bytes.byteLength,
        ContentMD5: contentMd5,
        Key: decodeURIComponent(url.pathname.slice(1)),
        PartNumber: partNumber,
        UploadId: url.searchParams.get("uploadId") ?? "",
      }),
    )) as { readonly ETag: string };
    return { byteLength: bytes.byteLength, etag: ETag, partNumber };
  }

  /** Sign one part, then send its bytes as a client would. */
  async function uploadPart(input: {
    readonly bytes: Uint8Array;
    readonly key: string;
    readonly partNumber: number;
    readonly uploadId: string;
  }): Promise<BlobObjectPart> {
    const signed = await store.createUploadPartUrl?.({
      byteLength: input.bytes.byteLength,
      contentMd5: createHash("md5").update(input.bytes).digest("base64"),
      expiresIn: 300,
      key: input.key,
      partNumber: input.partNumber,
      uploadId: input.uploadId,
    });
    if (!signed) throw new Error("Expected the fake store to sign uploads");
    return putSignedPart(signed.url, input.bytes);
  }

  return { client, putSignedPart, store, uploadPart };
}

export function listPartNumbers(
  parts: readonly BlobObjectPart[],
): readonly number[] {
  return parts.map((part) => part.partNumber);
}

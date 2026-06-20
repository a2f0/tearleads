import { expect } from "bun:test";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import type { BlobObjectPart } from "../../src/adapters/blobObjectStore";
import { createS3BlobObjectStore } from "../../src/adapters/s3BlobObjectStore";
import { sha256Hex } from "../../src/utils/sha256";

export interface CommandWithInput {
  readonly input: S3CommandInput;
}

interface S3CommandInput {
  readonly Body?: unknown;
  readonly ChecksumAlgorithm?: unknown;
  readonly ChecksumSHA256?: unknown;
  readonly ChecksumType?: unknown;
  readonly ContentLength?: unknown;
  readonly Key?: unknown;
  readonly MultipartUpload?: unknown;
  readonly MpuObjectSize?: unknown;
  readonly PartNumber?: unknown;
  readonly PartNumberMarker?: unknown;
  readonly UploadId?: unknown;
}

async function sha256Base64(value: string): Promise<string> {
  return Buffer.from(await sha256Hex(value), "hex").toString("base64");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

async function bodyToString(body: unknown): Promise<string> {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (body instanceof ReadableStream) {
    return new Response(body).text();
  }
  if (isAsyncIterable(body)) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
      if (typeof chunk === "string") {
        chunks.push(new TextEncoder().encode(chunk));
      } else if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
      } else {
        throw new Error("Unsupported test S3 body chunk");
      }
    }

    const bytes = new Uint8Array(
      chunks.reduce((byteLength, chunk) => byteLength + chunk.byteLength, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(bytes);
  }

  return String(body);
}

export function textStream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

class FakeS3Client {
  readonly commands: unknown[] = [];
  readonly objectBodies = new Map<string, unknown>();
  readonly objects = new Map<string, string>();
  readonly uploads = new Map<
    string,
    {
      readonly key: string;
      readonly parts: Map<
        number,
        { readonly bytes: string; readonly etag: string }
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
      const bytes = await bodyToString(input.Body);
      expect(input.ChecksumAlgorithm).toBe("SHA256");
      expect(input.ChecksumSHA256).toBe(await sha256Base64(bytes));
      expect(input.ContentLength).toBe(Buffer.byteLength(bytes, "utf8"));
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
          Size: Buffer.byteLength(part.bytes, "utf8"),
        })),
      };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      const upload = this.requireUpload(input);
      // Portable S3/Garage completion: validate by part ETag only. The
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
      const bytes = parts
        .map((part) => {
          const storedPart = upload.parts.get(Number(part.PartNumber));
          if (!storedPart || storedPart.etag !== part.ETag) {
            throw Object.assign(new Error("InvalidPart"), {
              name: "InvalidPart",
            });
          }

          return storedPart.bytes;
        })
        .join("");
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
    if (command instanceof PutObjectCommand) {
      const bytes = await bodyToString(input.Body);
      expect(input.ChecksumAlgorithm).toBe("SHA256");
      expect(input.ChecksumSHA256).toBe(await sha256Base64(bytes));
      expect(input.ContentLength).toBe(Buffer.byteLength(bytes, "utf8"));
      this.objects.set(String(input.Key), bytes);

      return {};
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

export function createFakeS3BlobObjectStore() {
  const client = new FakeS3Client();
  const store = createS3BlobObjectStore({
    bucket: "blob-test-bucket",
    client: client as unknown as Pick<S3Client, "send">,
  });

  return { client, store };
}

export function listPartNumbers(
  parts: readonly BlobObjectPart[],
): readonly number[] {
  return parts.map((part) => part.partNumber);
}

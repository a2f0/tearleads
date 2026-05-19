import { expect, test } from "bun:test";
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
import { sha256Hex } from "../utils/sha256";
import type { BlobObjectPart } from "./blobObjectStore";
import { createS3BlobObjectStore } from "./s3BlobObjectStore";

interface CommandWithInput {
  readonly input: S3CommandInput;
}

interface S3CommandInput {
  readonly Body?: unknown;
  readonly Key?: unknown;
  readonly MultipartUpload?: unknown;
  readonly PartNumber?: unknown;
  readonly PartNumberMarker?: unknown;
  readonly UploadId?: unknown;
}

class FakeS3Client {
  readonly commands: unknown[] = [];
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
      const etag = `"etag-${partNumber}"`;
      upload.parts.set(partNumber, {
        bytes: String(input.Body),
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
          Size: new TextEncoder().encode(part.bytes).byteLength,
        })),
      };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      const upload = this.requireUpload(input);
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

function createFakeS3BlobObjectStore() {
  const client = new FakeS3Client();
  const store = createS3BlobObjectStore({
    bucket: "blob-test-bucket",
    client: client as unknown as Pick<S3Client, "send">,
  });

  return { client, store };
}

function listPartNumbers(parts: readonly BlobObjectPart[]): readonly number[] {
  return parts.map((part) => part.partNumber);
}

test("S3 blob object store completes multipart uploads by part number", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  const { uploadId } = await store.createMultipartUpload({
    key: "blob-stages/s3-complete",
  });
  const secondPart = await store.uploadPart({
    bytes: "-second",
    key: "blob-stages/s3-complete",
    partNumber: 2,
    uploadId,
  });
  const firstPart = await store.uploadPart({
    bytes: "first",
    key: "blob-stages/s3-complete",
    partNumber: 1,
    uploadId,
  });

  expect(
    listPartNumbers(
      await store.listParts({ key: "blob-stages/s3-complete", uploadId }),
    ),
  ).toEqual([1, 2]);
  const completed = await store.completeMultipartUpload({
    key: "blob-stages/s3-complete",
    parts: [
      { etag: secondPart.etag, partNumber: 2 },
      { etag: firstPart.etag, partNumber: 1 },
    ],
    uploadId,
  });

  expect(await store.getObject("blob-stages/s3-complete")).toBe("first-second");
  expect(completed).toEqual({
    byteLength: new TextEncoder().encode("first-second").byteLength,
    sha256: await sha256Hex("first-second"),
  });
  const completeCommand = client.commands.find(
    (command) => command instanceof CompleteMultipartUploadCommand,
  ) as CommandWithInput | undefined;
  expect(completeCommand?.input.MultipartUpload).toEqual({
    Parts: [
      { ETag: firstPart.etag, PartNumber: 1 },
      { ETag: secondPart.etag, PartNumber: 2 },
    ],
  });
});

test("S3 blob object store follows list parts pagination", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  client.listPartsPageSize = 1;
  const { uploadId } = await store.createMultipartUpload({
    key: "blob-stages/s3-paginated-list",
  });
  await store.uploadPart({
    bytes: "first",
    key: "blob-stages/s3-paginated-list",
    partNumber: 1,
    uploadId,
  });
  await store.uploadPart({
    bytes: "second",
    key: "blob-stages/s3-paginated-list",
    partNumber: 2,
    uploadId,
  });

  expect(
    listPartNumbers(
      await store.listParts({
        key: "blob-stages/s3-paginated-list",
        uploadId,
      }),
    ),
  ).toEqual([1, 2]);
  expect(
    client.commands.filter((command) => command instanceof ListPartsCommand),
  ).toHaveLength(2);
});

test("S3 blob object store maps missing objects to null", async () => {
  const { store } = createFakeS3BlobObjectStore();

  await expect(store.getObject("blob-stages/missing")).resolves.toBeNull();
});

test("S3 blob object store deletes objects and aborts multipart uploads", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  client.objects.set("blob-stages/delete", "delete-me");
  const { uploadId } = await store.createMultipartUpload({
    key: "blob-stages/abort",
  });

  await store.deleteObject("blob-stages/delete");
  await store.abortMultipartUpload({
    key: "blob-stages/abort",
    uploadId,
  });

  expect(client.objects.has("blob-stages/delete")).toBe(false);
  expect(client.uploads.has(uploadId)).toBe(false);
});

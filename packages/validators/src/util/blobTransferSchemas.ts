import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import { boundedPositiveIntegerSchema } from "../schema";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "./blob";

function stringSchemaFragment(schema: z.ZodType<string>) {
  const { $schema: _dialect, ...fragment } = z.toJSONSchema(schema);
  return registerJsonSchemaFragment(
    z.custom<string>((value) => schema.safeParse(value).success),
    fragment,
  );
}

export const signedBlobUrlSchema = stringSchemaFragment(
  z.url().regex(/^https?:\/\//u),
);
export const signedBlobUrlExpirySchema = stringSchemaFragment(z.iso.datetime());

// R2 transport checksum; assembled SHA-256 remains the application authority.
export const blobPartContentMd5Schema = stringSchemaFragment(
  z.string().regex(/^[A-Za-z0-9+/]{21}[AQgw]==$/u),
);

/** S3/R2 multipart part numbers run from 1 through 10,000. */
export const MAX_MULTIPART_BLOB_PART_NUMBER = 10_000;

/**
 * One encrypted part as the client will send it: its number, exact length, and
 * the transport Content-MD5 a signed upload URL binds.
 */
export const MultipartBlobPartDescriptorSchema = z.strictObject({
  byteLength: boundedPositiveIntegerSchema(MAX_MULTIPART_BLOB_PART_BYTES),
  contentMd5: blobPartContentMd5Schema,
  partNumber: boundedPositiveIntegerSchema(MAX_MULTIPART_BLOB_PART_NUMBER),
});

export type MultipartBlobPartDescriptor = z.infer<
  typeof MultipartBlobPartDescriptorSchema
>;

/**
 * Where a part's bytes go: the API byte route for stores that cannot sign, or
 * a short-lived URL that signs exactly one part of one upload.
 */
export const MultipartBlobPartUploadSourceSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("api") }),
    z.strictObject({
      kind: z.literal("signed-url"),
      url: signedBlobUrlSchema,
      expiresAt: signedBlobUrlExpirySchema,
    }),
  ],
);

export type MultipartBlobPartUploadSource = z.infer<
  typeof MultipartBlobPartUploadSourceSchema
>;

export const MultipartBlobPartUploadSchema =
  MultipartBlobPartDescriptorSchema.extend({
    source: MultipartBlobPartUploadSourceSchema,
  });

export type MultipartBlobPartUpload = z.infer<
  typeof MultipartBlobPartUploadSchema
>;

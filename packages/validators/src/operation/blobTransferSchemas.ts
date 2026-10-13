import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";

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

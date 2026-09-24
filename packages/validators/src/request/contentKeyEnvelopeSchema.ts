import { z } from "zod";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaView,
} from "../jsonSchema";
import { plainObjectSchema } from "../schema";

// Both sizes are multiples of three, so canonical base64 contains no padding.
// AES-GCM wraps a 32-byte key with a 16-byte tag and a separate 12-byte IV.
function fixedBase64Schema(length: number) {
  const pattern = `^[A-Za-z0-9+/]{${length}}$`;
  const expression = new RegExp(pattern, "u");
  return registerJsonSchemaFragment(
    z.custom<string>(
      (value) =>
        typeof value === "string" &&
        value.length === length &&
        expression.test(value),
    ),
    { type: "string", minLength: length, maxLength: length, pattern },
  );
}

export const ContentKeyWrappedKeySchema = fixedBase64Schema(64);

export function contentKeyWrappingMetadataSchema(kind: "document" | "blob") {
  const shape = z.strictObject({
    suite: z.literal(
      `tearleads.${kind}.content-key-wrap.aes-256-gcm-container-kek`,
    ),
    iv: fixedBase64Schema(16),
  });
  // Keep metadata opaque to envelope consumers, which verify both submitted
  // and stored envelopes. Runtime validation and OpenAPI use the same shape.
  return registerJsonSchemaView(
    plainObjectSchema.refine((value) => shape.safeParse(value).success),
    shape,
  );
}

import { expect, test } from "bun:test";
import { toJsonSchema } from "../jsonSchema";
import { BlobContentKeyTargetEnvelopeRequestSchema } from "./blob";
import { DocumentContentKeyTargetEnvelopeSchema } from "./documentSyncSchema";

for (const kind of ["document", "blob"] as const) {
  const schema =
    kind === "document"
      ? DocumentContentKeyTargetEnvelopeSchema
      : BlobContentKeyTargetEnvelopeRequestSchema;
  const valid = {
    bindingId: "binding",
    documentId: "document",
    containerId: "container",
    containerKeyEpoch: 1,
    containerKeyEpochId: "epoch",
    containerManifestHash: "manifest",
    wrappedKey: "A".repeat(64),
    wrappingMetadata: {
      suite: `tearleads.${kind}.content-key-wrap.aes-256-gcm-container-kek`,
      iv: "A".repeat(16),
    },
  };
  test(`${kind} requests reject noncanonical envelope fields at the schema boundary`, () => {
    expect(schema.safeParse(valid).success).toBe(true);
    for (const change of [
      { wrappedKey: "A".repeat(60) },
      { wrappedKey: `${"A".repeat(63)}=` },
      { wrappingMetadata: {} },
      { wrappingMetadata: { ...valid.wrappingMetadata, iv: "A".repeat(12) } },
      {
        wrappingMetadata: {
          ...valid.wrappingMetadata,
          iv: `${"A".repeat(15)}_`,
        },
      },
      { wrappingMetadata: { ...valid.wrappingMetadata, extra: true } },
      { wrappingMetadata: { ...valid.wrappingMetadata, suite: "unknown" } },
    ]) {
      expect(schema.safeParse({ ...valid, ...change }).success).toBe(false);
    }
  });
  test(`${kind} OpenAPI describes exact ciphertext and metadata fields`, () => {
    expect(toJsonSchema(schema)).toMatchObject({
      properties: {
        wrappedKey: {
          type: "string",
          minLength: 64,
          maxLength: 64,
          pattern: "^[A-Za-z0-9+/]{64}$",
        },
        wrappingMetadata: {
          type: "object",
          additionalProperties: false,
          required: ["suite", "iv"],
          properties: {
            suite: { type: "string", const: valid.wrappingMetadata.suite },
            iv: { type: "string", minLength: 16, maxLength: 16 },
          },
        },
      },
    });
  });
}

export function contentKeyEnvelopeFixture<Kind extends "document" | "blob">(
  kind: Kind,
) {
  return {
    wrappedKey: "A".repeat(64),
    wrappingMetadata: {
      suite:
        `tearleads.${kind}.content-key-wrap.aes-256-gcm-container-kek` as const,
      iv: "A".repeat(16),
    },
  };
}

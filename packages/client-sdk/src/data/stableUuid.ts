const TEXT_ENCODER = new TextEncoder();

function concatenateBytes(left: Uint8Array, right: Uint8Array) {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(left, 0);
  bytes.set(right, left.byteLength);
  return bytes;
}

function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, byteToHex).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toUuidV4ShapedBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice(0, 16).map((byte, index) => {
    if (index === 6) {
      return (byte & 0x0f) | 0x40;
    }

    if (index === 8) {
      return (byte & 0x3f) | 0x80;
    }

    return byte;
  });
}

/**
 * Derives a stable, UUID-shaped id from a 16-byte namespace and a name string.
 *
 * The digest (RFC-4122 v5 style: SHA-1 over namespace ++ name) makes the id
 * idempotent — the same inputs always yield the same id, so a retry after a lost
 * response re-sends the id the first attempt used. The version and variant bits
 * are normalized to a v4 shape because the remote APIs validate ids against the
 * same v4 UUID contract they use for random `crypto.randomUUID()` ids.
 */
export async function deriveStableUuidV4Shaped(
  namespace: Uint8Array,
  name: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-1",
      concatenateBytes(namespace, TEXT_ENCODER.encode(name)),
    ),
  );
  return formatUuid(toUuidV4ShapedBytes(digest));
}

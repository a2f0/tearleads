const encoder = new TextEncoder();

/**
 * The UTF-8 size of a client frame. The frame arrives as a string, and a
 * string's length counts UTF-16 units, so the protocol's byte ceiling and the
 * queue's byte budget measure the encoded bytes instead.
 */
export function clientMessageByteLength(message: string): number {
  return encoder.encode(message).byteLength;
}

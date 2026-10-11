import { MAX_WS_CLIENT_MESSAGE_BYTES } from "@tearleads/validators/realtime";

const encoder = new TextEncoder();

/**
 * Whether a client frame exceeds the protocol's byte ceiling. The frame
 * arrives as a string, and a string's length counts UTF-16 units, so the
 * check measures the UTF-8 bytes the ceiling is defined in.
 */
export function exceedsClientMessageLimit(message: string): boolean {
  // A UTF-16 unit never encodes to more than three UTF-8 bytes, so a short
  // enough string needs no encoding pass.
  if (message.length * 3 <= MAX_WS_CLIENT_MESSAGE_BYTES) {
    return false;
  }
  return encoder.encode(message).byteLength > MAX_WS_CLIENT_MESSAGE_BYTES;
}

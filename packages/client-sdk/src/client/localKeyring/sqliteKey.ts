import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { copyBytes } from "./primitives";

export function decodeLocalKeyringSqliteKey(
  sqliteKey: string,
): Uint8Array<ArrayBuffer> {
  return copyBytes(base64ToBytes(sqliteKey));
}

export function encodeLocalKeyringSqliteKey(sqliteKey: Uint8Array): string {
  return bytesToBase64(sqliteKey);
}

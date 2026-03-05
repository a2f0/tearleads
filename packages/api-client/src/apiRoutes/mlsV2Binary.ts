export function stringToProtoBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

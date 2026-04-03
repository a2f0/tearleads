import { toFingerprint } from "@tearleads/crypto";

const textEncoder = new TextEncoder();

export async function computeAccessFingerprint(
  value: unknown,
): Promise<string> {
  return toFingerprint(textEncoder.encode(JSON.stringify(value)));
}

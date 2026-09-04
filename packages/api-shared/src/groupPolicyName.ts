import { base64ToBytes } from "@tearleads/encoding";

/**
 * Current group payloads are signed plaintext base64 JSON. This is the format
 * deployed by the SDK, despite the encrypted-payload wire field names. A future
 * encrypted format must replace this parser and its deployment gate together.
 */
export function readSignedGroupPolicyName(ciphertext: string): string | null {
  const payload: unknown = JSON.parse(
    new TextDecoder().decode(base64ToBytes(ciphertext)),
  );
  const name: unknown =
    payload !== null && typeof payload === "object"
      ? Reflect.get(payload, "name")
      : undefined;
  return typeof name === "string" &&
    name.trim().length > 0 &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]/u.test(name)
    ? name
    : null;
}

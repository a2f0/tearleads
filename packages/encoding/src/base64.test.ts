import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "./base64";

test("base64 helpers round-trip byte arrays", () => {
  const bytes = new Uint8Array([0, 1, 2, 15, 16, 31, 127, 128, 254, 255]);
  const encoded = bytesToBase64(bytes);

  expect(encoded).toBe("AAECDxAff4D+/w==");
  expect(base64ToBytes(encoded)).toEqual(bytes);
});

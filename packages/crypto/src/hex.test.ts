import { expect, test } from "bun:test";
import { bytesToHex, hexToBytes } from "./hex";

test("hex helpers round-trip byte arrays", () => {
  const bytes = new Uint8Array([0, 1, 15, 16, 254, 255]);
  const hex = bytesToHex(bytes);

  expect(hex).toBe("00010f10feff");
  expect(hexToBytes(hex)).toEqual(bytes);
  expect(hexToBytes(hex.toUpperCase())).toEqual(bytes);
});

test("hexToBytes rejects malformed input", () => {
  expect(() => hexToBytes("abc")).toThrow("Invalid hex string");
  expect(() => hexToBytes("zz")).toThrow("Invalid hex string");
});

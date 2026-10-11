import { expect, test } from "bun:test";
import { clientMessageByteLength } from "./socketMessageLimit";

test("ASCII frames measure one byte per character", () => {
  expect(clientMessageByteLength("abc")).toBe(3);
});

test("multibyte frames measure UTF-8 bytes, not UTF-16 units", () => {
  expect("€€".length).toBe(2);
  expect(clientMessageByteLength("€€")).toBe(6);
});

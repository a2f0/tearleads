import { expect, test } from "bun:test";
import { normalizeRecoveryKey } from "./recoveryKey";

test("recovery keys normalize to lowercase words and single spaces", () => {
  expect(normalizeRecoveryKey("  Abandon   ABILITY\n able\t")).toBe(
    "abandon ability able",
  );
});

test("recovery keys with anything but words are refused", () => {
  for (const input of ["", 'abandon "ability', "abandon1 ability", "a;b"]) {
    expect(() => normalizeRecoveryKey(input)).toThrow(
      "A recovery key is a list of words",
    );
  }
});

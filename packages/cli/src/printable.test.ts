import { expect, test } from "bun:test";
import { printable } from "./printable";

test("control, escape, and bidi characters are shown escaped", () => {
  expect(printable("Docs\u001b]52;c;aGk=\u0007")).toBe(
    "Docs\\u{001b}]52;c;aGk=\\u{0007}",
  );
  expect(printable("a\nb\rc\td")).toBe("a\\u{000a}b\\u{000d}c\\u{0009}d");
  expect(printable("\u202egnp.exe")).toBe("\\u{202e}gnp.exe");
  expect(printable("\u009b2J")).toBe("\\u{009b}2J");
});

test("ordinary text, including non-Latin names, is unchanged", () => {
  expect(printable("Café / 資料 / Ünïcode  id-1")).toBe(
    "Café / 資料 / Ünïcode  id-1",
  );
});

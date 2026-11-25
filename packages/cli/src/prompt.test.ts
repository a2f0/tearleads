import { expect, test } from "bun:test";
import { withoutLineEnding } from "./prompt";

test("a piped password loses only its final line ending", () => {
  expect(withoutLineEnding("hunter2\n")).toBe("hunter2");
  expect(withoutLineEnding("hunter2\r\n")).toBe("hunter2");
  expect(withoutLineEnding("hunter2")).toBe("hunter2");
  expect(withoutLineEnding(" spaced pass \n")).toBe(" spaced pass ");
  expect(withoutLineEnding("two\n\n")).toBe("two\n");
});

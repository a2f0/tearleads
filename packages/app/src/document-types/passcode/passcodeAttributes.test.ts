import { expect, test } from "bun:test";
import { newPasscodeAttributeCells } from "./passcodeAttributes";

test("a new attribute takes the next number no other attribute uses", () => {
  expect(newPasscodeAttributeCells([])).toEqual({
    name: "Attribute 1",
    protected: "",
    value: "",
  });
  // "Attribute 1" was removed, so the count alone would repeat "Attribute 2".
  expect(newPasscodeAttributeCells([{ name: "Attribute 2" }])).toMatchObject({
    name: "Attribute 3",
  });
  expect(
    newPasscodeAttributeCells([{ name: "PIN" }, { name: "Attribute 4" }]),
  ).toMatchObject({
    name: "Attribute 3",
  });
});

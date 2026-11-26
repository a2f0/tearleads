import { expect, test } from "bun:test";
import { isSeedFolderName } from "./seedFolderTarget";

test("a seed folder name is the dataset's, or it numbered past a clash", () => {
  expect(isSeedFolderName("Family", "Family")).toBe(true);
  expect(isSeedFolderName("Family (2)", "Family")).toBe(true);
  expect(isSeedFolderName("Family (12)", "Family")).toBe(true);
  for (const name of [
    "Family (1)",
    "Family (02)",
    "Family ()",
    "Family (2) ",
    "Family photos",
    "Family (x)",
    "family",
    "Other",
  ]) {
    expect(isSeedFolderName(name, "Family")).toBe(false);
  }
});

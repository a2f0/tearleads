import { describe, expect, test } from "bun:test";
import { partialRestoreError, uniqueFolderName } from "./restoreFolders";

describe("uniqueFolderName", () => {
  test("numbers a name its siblings already use", () => {
    expect(uniqueFolderName("Vault", new Set(["Other"]))).toBe("Vault");
    expect(uniqueFolderName("Vault", new Set(["Vault"]))).toBe("Vault (2)");
    expect(
      uniqueFolderName("Vault", new Set(["Vault", "Vault (2)", "Vault (4)"])),
    ).toBe("Vault (3)");
  });
});

test("a partial restore names the folder to delete", () => {
  const cause = new Error("Could not restore passcode 3 of 5: offline.");
  const error = partialRestoreError(cause, "Vault (2)");
  expect(error.message).toBe(
    'Could not restore passcode 3 of 5: offline. Delete the folder "Vault (2)" if it was created, then run the command again.',
  );
  expect(error.cause).toBe(cause);
});

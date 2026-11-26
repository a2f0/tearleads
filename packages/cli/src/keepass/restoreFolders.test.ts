import { expect, test } from "bun:test";
import { partialRestoreError } from "./restoreFolders";

test("a partial restore names the folder to delete", () => {
  const cause = new Error("Could not restore passcode 3 of 5: offline.");
  const error = partialRestoreError(cause, "Vault (2)");
  expect(error.message).toBe(
    'Could not restore passcode 3 of 5: offline. Delete the folder "Vault (2)" if it was created, then run the command again.',
  );
  expect(error.cause).toBe(cause);
});

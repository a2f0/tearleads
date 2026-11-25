import { describe, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import {
  partialRestoreError,
  uniqueFolderName,
  unsyncedFoldersReason,
} from "./restoreFolders";

type FolderState = Pick<ContainerNode, "id" | "syncState">;

function folder(
  id: string,
  status: ContainerNode["syncState"]["status"],
  lastError: string | null = null,
): FolderState {
  return {
    id,
    syncState: {
      lastError,
      pendingAttachmentBytes: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      status,
    },
  };
}

describe("uniqueFolderName", () => {
  test("numbers a name its siblings already use", () => {
    expect(uniqueFolderName("Vault", new Set(["Other"]))).toBe("Vault");
    expect(uniqueFolderName("Vault", new Set(["Vault"]))).toBe("Vault (2)");
    expect(
      uniqueFolderName("Vault", new Set(["Vault", "Vault (2)", "Vault (4)"])),
    ).toBe("Vault (3)");
  });
});

describe("unsyncedFoldersReason", () => {
  const ids = ["root", "child"];

  test("is null once every restored folder is synced", () => {
    const nodes = [folder("root", "synced"), folder("child", "synced")];
    expect(unsyncedFoldersReason(true, nodes, ids)).toBeNull();
  });

  test("refuses a timeout, an unsynced folder, or a missing one", () => {
    const synced = [folder("root", "synced"), folder("child", "synced")];
    expect(unsyncedFoldersReason(false, synced, ids)).toBe("timed out");
    expect(
      unsyncedFoldersReason(
        true,
        [folder("root", "synced"), folder("child", "error", "409 conflict")],
        ids,
      ),
    ).toBe("409 conflict");
    expect(
      unsyncedFoldersReason(
        true,
        [folder("root", "synced"), folder("child", "pending")],
        ids,
      ),
    ).toBe("pending");
    expect(unsyncedFoldersReason(true, [folder("root", "synced")], ids)).toBe(
      "missing from the folder tree",
    );
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

import { expect, test } from "bun:test";
import {
  type ExplorerUploadItem,
  type ExplorerUploadItemEvent,
  transitionExplorerUploadItem,
} from "./explorerUploadItemMachine";

const queued: ExplorerUploadItem = {
  containerId: "folder",
  error: null,
  fileName: "a.txt",
  fileSize: 1,
  id: "upload-1",
  localId: null,
  status: "queued",
  storageKeys: [],
};

const imported: ExplorerUploadItemEvent = {
  localId: "local-1",
  storageKeys: ["blob-1"],
  type: "imported",
};

function run(
  events: ReadonlyArray<ExplorerUploadItemEvent>,
  from: ExplorerUploadItem = queued,
): ExplorerUploadItem {
  return events.reduce(transitionExplorerUploadItem, from);
}

test("an upload moves from queued through imported to uploaded", () => {
  expect(run([{ type: "import-started" }]).status).toBe("importing");
  const stored = run([{ type: "import-started" }, imported]);
  expect(stored).toMatchObject({
    localId: "local-1",
    status: "imported",
    storageKeys: ["blob-1"],
  });
  expect(run([{ type: "upload-confirmed" }], stored).status).toBe("uploaded");
  // Confirmation only applies to an imported file.
  expect(
    transitionExplorerUploadItem(queued, { type: "upload-confirmed" }),
  ).toBe(queued);
});

test("terminal statuses ignore later events", () => {
  const uploaded = run([imported, { type: "upload-confirmed" }]);
  for (const event of [
    { type: "import-started" },
    imported,
    { error: "late", type: "file-failed" },
    { error: "late", type: "selection-failed" },
    { type: "cancelled" },
    { type: "upload-confirmed" },
  ] satisfies ReadonlyArray<ExplorerUploadItemEvent>) {
    expect(transitionExplorerUploadItem(uploaded, event)).toBe(uploaded);
  }
  const cancelled = run([{ type: "cancelled" }]);
  expect(transitionExplorerUploadItem(cancelled, imported)).toBe(cancelled);
});

test("a file can fail after import, but a selection failure spares it", () => {
  const stored = run([imported]);
  expect(
    transitionExplorerUploadItem(stored, {
      error: "summary read failed",
      type: "file-failed",
    }),
  ).toMatchObject({ error: "summary read failed", status: "failed" });
  expect(
    transitionExplorerUploadItem(stored, {
      error: "refused",
      type: "selection-failed",
    }),
  ).toBe(stored);
  expect(transitionExplorerUploadItem(stored, { type: "cancelled" })).toBe(
    stored,
  );
  expect(run([{ error: "refused", type: "selection-failed" }])).toMatchObject({
    error: "refused",
    status: "failed",
  });
});

import { expect, mock, test } from "bun:test";

const deleted: string[] = [];

// iOS keeps share and preview copies in the cache directory and camera
// captures in tmp; both hold directories the WebView owns.
const entriesByDirectory: Record<
  string,
  { name: string; type: "directory" | "file" }[]
> = {
  CACHE: [
    { name: "statement.pdf", type: "file" },
    { name: "preview_3_photo.jpg", type: "file" },
    { name: "WebKit", type: "directory" },
  ],
  TEMPORARY: [
    { name: "photo_1700000000.jpg", type: "file" },
    { name: "WebKit", type: "directory" },
  ],
};

mock.module("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE", Temporary: "TEMPORARY" },
  Filesystem: {
    deleteFile: ({ directory, path }: { directory: string; path: string }) => {
      deleted.push(`${directory}/${path}`);
      return Promise.resolve();
    },
    readdir: ({ directory }: { directory: string }) =>
      Promise.resolve({ files: entriesByDirectory[directory] ?? [] }),
  },
}));

// Imported after the mock so the module binds the mocked Filesystem.
const { deleteStagedNativeFiles } = await import("./capacitorCacheFile");

test("a device reset removes every staged copy and camera capture, and no directory", async () => {
  await deleteStagedNativeFiles();

  expect(deleted.toSorted()).toEqual([
    "CACHE/preview_3_photo.jpg",
    "CACHE/statement.pdf",
    "TEMPORARY/photo_1700000000.jpg",
  ]);
});

import { expect, mock, test } from "bun:test";

const deletedPaths: string[] = [];

mock.module("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: {
    deleteFile: ({ path }: { path: string }) => {
      deletedPaths.push(path);
      return Promise.resolve();
    },
    readdir: () =>
      Promise.resolve({
        files: [
          { name: "statement.pdf", type: "file" },
          { name: "preview_3_photo.jpg", type: "file" },
          { name: "WebKit", type: "directory" },
        ],
      }),
  },
}));

// Imported after the mock so the module binds the mocked Filesystem.
const { deleteCacheFilesWithPrefix } = await import("./capacitorCacheFile");

test("a device reset's cache cleanup removes every staged file and no directory", async () => {
  await deleteCacheFilesWithPrefix("");

  expect(deletedPaths.toSorted()).toEqual([
    "preview_3_photo.jpg",
    "statement.pdf",
  ]);
});

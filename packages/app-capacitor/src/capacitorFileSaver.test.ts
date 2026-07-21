import { afterEach, expect, mock, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";

interface WriteFileCall {
  data: string;
  directory: string;
  path: string;
  recursive?: boolean;
}
interface ShareCall {
  dialogTitle?: string;
  title?: string;
  url?: string;
}
interface DeleteCall {
  directory: string;
  path: string;
}

// Mutable fixture the mocked native plugins record into, plus the behaviors a
// test arms before saving (a share rejection, a returned uri).
const fixture: {
  writeCalls: WriteFileCall[];
  shareCalls: ShareCall[];
  deleteCalls: DeleteCall[];
  writeUri: string;
  shareRejection: Error | null;
} = {
  writeCalls: [],
  shareCalls: [],
  deleteCalls: [],
  writeUri: "file:///cache/download",
  shareRejection: null,
};

mock.module("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: {
    writeFile: (options: WriteFileCall) => {
      fixture.writeCalls.push(options);
      return Promise.resolve({ uri: fixture.writeUri });
    },
    deleteFile: (options: DeleteCall) => {
      fixture.deleteCalls.push(options);
      return Promise.resolve();
    },
  },
}));

mock.module("@capacitor/share", () => ({
  Share: {
    share: (options: ShareCall) => {
      fixture.shareCalls.push(options);
      return fixture.shareRejection
        ? Promise.reject(fixture.shareRejection)
        : Promise.resolve({
            activityType: "com.apple.UIKit.activity.SaveToFile",
          });
    },
  },
}));

// Imported after the module mocks so the saver binds to them, not the real
// native bridge.
const { createCapacitorFileSaver } = await import("./capacitorFileSaver");

afterEach(() => {
  fixture.writeCalls = [];
  fixture.shareCalls = [];
  fixture.deleteCalls = [];
  fixture.writeUri = "file:///cache/download";
  fixture.shareRejection = null;
});

// Lets the finally-block cleanup (deleteFile) settle before assertions.
function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test("writes base64 bytes to the cache, then opens the share sheet", async () => {
  const saver = createCapacitorFileSaver();
  const data = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;

  await saver.saveFile({ data, fileName: "notes.txt", mimeType: "text/plain" });

  expect(fixture.writeCalls).toHaveLength(1);
  const write = fixture.writeCalls[0];
  expect(write?.directory).toBe("CACHE");
  expect(write?.path).toBe("notes.txt");
  // The bytes are handed to writeFile as base64 (native cannot take a raw
  // Uint8Array), so decoding them round-trips to the original file.
  expect([...base64ToBytes(write?.data ?? "")]).toEqual([1, 2, 3, 4]);

  expect(fixture.shareCalls).toHaveLength(1);
  expect(fixture.shareCalls[0]?.url).toBe("file:///cache/download");
  expect(fixture.shareCalls[0]?.title).toBe("notes.txt");
});

test("flattens path separators in the file name so the write stays flat", async () => {
  const saver = createCapacitorFileSaver();

  await saver.saveFile({
    data: new Uint8Array([0]) as Uint8Array<ArrayBuffer>,
    fileName: "blobs/2026/report.pdf",
    mimeType: null,
  });

  expect(fixture.writeCalls[0]?.path).toBe("blobs_2026_report.pdf");
});

test("rejects a bare dot/dot-dot name so the write cannot escape the cache dir", async () => {
  const saver = createCapacitorFileSaver();

  for (const fileName of ["..", ".", "   "]) {
    await saver.saveFile({
      data: new Uint8Array([0]) as Uint8Array<ArrayBuffer>,
      fileName,
    });
  }

  expect(fixture.writeCalls.map((call) => call.path)).toEqual([
    "download",
    "download",
    "download",
  ]);
});

test("removes the staged cache copy after the share completes", async () => {
  const saver = createCapacitorFileSaver();

  await saver.saveFile({
    data: new Uint8Array([9]) as Uint8Array<ArrayBuffer>,
    fileName: "a.bin",
  });
  await flushAsync();

  expect(fixture.deleteCalls).toEqual([{ directory: "CACHE", path: "a.bin" }]);
});

test("swallows a user-cancelled share instead of surfacing it as a failure", async () => {
  fixture.shareRejection = new Error("Share canceled");
  const saver = createCapacitorFileSaver();

  // Resolves (no throw) even though the native share rejected on cancel.
  await saver.saveFile({
    data: new Uint8Array([1]) as Uint8Array<ArrayBuffer>,
    fileName: "a.bin",
  });
  await flushAsync();

  // The cache copy is still cleaned up after a cancel.
  expect(fixture.deleteCalls).toHaveLength(1);
});

test("re-throws a genuine share failure", async () => {
  fixture.shareRejection = new Error("share target unavailable");
  const saver = createCapacitorFileSaver();

  await expect(
    saver.saveFile({
      data: new Uint8Array([1]) as Uint8Array<ArrayBuffer>,
      fileName: "a.bin",
    }),
  ).rejects.toThrow("share target unavailable");
});

import { afterEach, expect, mock, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";

interface WriteCall {
  data: string;
  directory: string;
  path: string;
  recursive?: boolean;
}

interface CacheEntry {
  name: string;
  type: "directory" | "file";
}

const fixture: {
  cacheEntries: CacheEntry[];
  deletePaths: string[];
  openPaths: string[];
  openRejection: Error | null;
  platform: string;
  writeCalls: WriteCall[];
} = {
  cacheEntries: [],
  deletePaths: [],
  openPaths: [],
  openRejection: null,
  platform: "ios",
  writeCalls: [],
};

mock.module("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => fixture.platform },
}));

mock.module("@capacitor/file-viewer", () => ({
  FileViewer: {
    openDocumentFromLocalPath: ({ path }: { path: string }) => {
      fixture.openPaths.push(path);
      return fixture.openRejection
        ? Promise.reject(fixture.openRejection)
        : Promise.resolve();
    },
  },
}));

mock.module("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: {
    deleteFile: ({ path }: { path: string }) => {
      fixture.deletePaths.push(path);
      return Promise.resolve();
    },
    readdir: () => Promise.resolve({ files: fixture.cacheEntries }),
    writeFile: (options: WriteCall) => {
      fixture.writeCalls.push(options);
      return Promise.resolve({ uri: `file:///cache/${options.path}` });
    },
  },
}));

const { createCapacitorFileViewer } = await import("./capacitorFileViewer");

afterEach(() => {
  fixture.cacheEntries = [];
  fixture.deletePaths = [];
  fixture.openPaths = [];
  fixture.openRejection = null;
  fixture.platform = "ios";
  fixture.writeCalls = [];
});

function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function writtenPath(index = 0): string {
  const path = fixture.writeCalls[index]?.path;
  if (!path) {
    throw new Error(`Expected cache write ${index}`);
  }
  return path;
}

test("stages PDF bytes and opens the native viewer", async () => {
  const viewer = createCapacitorFileViewer();
  const data = new Uint8Array([37, 80, 68, 70]) as Uint8Array<ArrayBuffer>;

  await viewer.viewFile({
    data,
    fileName: "reports/q3.pdf",
    mimeType: "application/pdf",
  });

  const stagedPath = writtenPath();
  expect(stagedPath.startsWith("preview_")).toBe(true);
  expect(stagedPath.endsWith("_reports_q3.pdf")).toBe(true);
  expect([...base64ToBytes(fixture.writeCalls[0]?.data ?? "")]).toEqual([
    37, 80, 68, 70,
  ]);
  expect(fixture.openPaths).toEqual([`file:///cache/${stagedPath}`]);
});

test("removes the iOS cache copy after the preview closes", async () => {
  const viewer = createCapacitorFileViewer();

  await viewer.viewFile({
    data: new Uint8Array([1]) as Uint8Array<ArrayBuffer>,
    fileName: "paper.pdf",
  });
  await flushAsync();

  expect(fixture.deletePaths).toEqual([writtenPath()]);
});

test("keeps only the latest Android cache copy for the external PDF app", async () => {
  fixture.platform = "android";
  const viewer = createCapacitorFileViewer();

  await viewer.viewFile({
    data: new Uint8Array([1]) as Uint8Array<ArrayBuffer>,
    fileName: "paper.pdf",
  });
  await flushAsync();

  expect(fixture.deletePaths).toEqual([]);

  const firstPath = writtenPath();
  await viewer.viewFile({
    data: new Uint8Array([2]) as Uint8Array<ArrayBuffer>,
    fileName: "paper.pdf",
  });

  expect(writtenPath(1)).not.toBe(firstPath);
  expect(fixture.deletePaths).toEqual([firstPath]);
});

test("removes preview cache files left by the prior app session", async () => {
  fixture.platform = "android";
  fixture.cacheEntries = [
    { name: "preview_stale_paper.pdf", type: "file" },
    { name: "shared_report.pdf", type: "file" },
    { name: "preview_folder", type: "directory" },
  ];
  const viewer = createCapacitorFileViewer();

  await viewer.viewFile({
    data: new Uint8Array([1]) as Uint8Array<ArrayBuffer>,
    fileName: "paper.pdf",
  });

  expect(fixture.deletePaths).toEqual(["preview_stale_paper.pdf"]);
});

test("cleans up and rethrows when no native viewer can open the PDF", async () => {
  fixture.platform = "android";
  fixture.openRejection = new Error("No activity found");
  const viewer = createCapacitorFileViewer();

  await expect(
    viewer.viewFile({
      data: new Uint8Array([1]) as Uint8Array<ArrayBuffer>,
      fileName: "paper.pdf",
    }),
  ).rejects.toThrow("No activity found");
  await flushAsync();

  expect(fixture.deletePaths).toEqual([writtenPath()]);
});

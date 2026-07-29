import { afterEach, expect, mock, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";

interface WriteCall {
  data: string;
  directory: string;
  path: string;
  recursive?: boolean;
}

const fixture: {
  deletePaths: string[];
  openPaths: string[];
  openRejection: Error | null;
  platform: string;
  writeCalls: WriteCall[];
} = {
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
    writeFile: (options: WriteCall) => {
      fixture.writeCalls.push(options);
      return Promise.resolve({ uri: `file:///cache/${options.path}` });
    },
  },
}));

const { createCapacitorFileViewer } = await import("./capacitorFileViewer");

afterEach(() => {
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

test("stages PDF bytes and opens the native viewer", async () => {
  const viewer = createCapacitorFileViewer();
  const data = new Uint8Array([37, 80, 68, 70]) as Uint8Array<ArrayBuffer>;

  await viewer.viewFile({
    data,
    fileName: "reports/q3.pdf",
    mimeType: "application/pdf",
  });

  expect(fixture.writeCalls[0]?.path).toBe("preview_reports_q3.pdf");
  expect([...base64ToBytes(fixture.writeCalls[0]?.data ?? "")]).toEqual([
    37, 80, 68, 70,
  ]);
  expect(fixture.openPaths).toEqual(["file:///cache/preview_reports_q3.pdf"]);
});

test("removes the iOS cache copy after the preview closes", async () => {
  const viewer = createCapacitorFileViewer();

  await viewer.viewFile({
    data: new Uint8Array([1]) as Uint8Array<ArrayBuffer>,
    fileName: "paper.pdf",
  });
  await flushAsync();

  expect(fixture.deletePaths).toEqual(["preview_paper.pdf"]);
});

test("keeps the Android cache copy available to the external PDF app", async () => {
  fixture.platform = "android";
  const viewer = createCapacitorFileViewer();

  await viewer.viewFile({
    data: new Uint8Array([1]) as Uint8Array<ArrayBuffer>,
    fileName: "paper.pdf",
  });
  await flushAsync();

  expect(fixture.deletePaths).toEqual([]);
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

  expect(fixture.deletePaths).toEqual(["preview_paper.pdf"]);
});

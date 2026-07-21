import { expect, test } from "bun:test";
import {
  ELECTROBUN_FILE_NAME_HEADER,
  ELECTROBUN_SAVE_FILE_PATH,
} from "./saveFileBridge";
import {
  planSaveFileRequest,
  resolveUniqueDownloadPath,
  sanitizeDownloadFileName,
} from "./saveFileHandler";

const ORIGIN = "http://127.0.0.1:3002";

function saveRequest(input: {
  fileName?: string | null;
  body?: Uint8Array<ArrayBuffer>;
  method?: string;
  path?: string;
}): Request {
  const headers = new Headers();
  if (input.fileName != null) {
    headers.set(
      ELECTROBUN_FILE_NAME_HEADER,
      encodeURIComponent(input.fileName),
    );
  }
  return new Request(`${ORIGIN}${input.path ?? ELECTROBUN_SAVE_FILE_PATH}`, {
    body: input.body ?? new Uint8Array([1, 2, 3]),
    headers,
    method: input.method ?? "POST",
  });
}

test("reduces a path-bearing name to a flat base name", () => {
  expect(sanitizeDownloadFileName("blobs/2026/report.pdf")).toBe("report.pdf");
  expect(sanitizeDownloadFileName("a\\b\\c.txt")).toBe("c.txt");
});

test("collapses traversal, dot, and empty names to a safe default", () => {
  expect(sanitizeDownloadFileName("../../etc/passwd")).toBe("passwd");
  expect(sanitizeDownloadFileName("..")).toBe("download");
  expect(sanitizeDownloadFileName(".")).toBe("download");
  expect(sanitizeDownloadFileName("")).toBe("download");
  expect(sanitizeDownloadFileName("   ")).toBe("download");
});

test("returns the plain path when nothing exists", () => {
  expect(resolveUniqueDownloadPath("/downloads", "a.pdf", () => false)).toBe(
    "/downloads/a.pdf",
  );
});

test("deconflicts against existing files by appending a counter", () => {
  const taken = new Set(["/downloads/a.pdf", "/downloads/a (1).pdf"]);
  expect(
    resolveUniqueDownloadPath("/downloads", "a.pdf", (path) => taken.has(path)),
  ).toBe("/downloads/a (2).pdf");
});

test("deconflicts a name that has no extension", () => {
  const taken = new Set(["/downloads/README"]);
  expect(
    resolveUniqueDownloadPath("/downloads", "README", (path) =>
      taken.has(path),
    ),
  ).toBe("/downloads/README (1)");
});

test("ignores requests that are not the save-file POST", async () => {
  const wrongMethod = await planSaveFileRequest(
    saveRequest({ fileName: "a.pdf", method: "GET" }),
    { downloadsDir: "/downloads", exists: () => false },
  );
  expect(wrongMethod.kind).toBe("ignore");

  const wrongPath = await planSaveFileRequest(
    saveRequest({ fileName: "a.pdf", path: "/worker.js" }),
    { downloadsDir: "/downloads", exists: () => false },
  );
  expect(wrongPath.kind).toBe("ignore");
});

test("rejects a save POST with no file-name header (blocks cross-origin posts)", async () => {
  const plan = await planSaveFileRequest(saveRequest({ fileName: null }), {
    downloadsDir: "/downloads",
    exists: () => false,
  });
  expect(plan).toEqual({
    kind: "reject",
    message: "Missing file name",
    status: 400,
  });
});

test("plans a write with a sanitized, deconflicted path and the posted bytes", async () => {
  const plan = await planSaveFileRequest(
    saveRequest({
      body: new Uint8Array([9, 8, 7]),
      fileName: "reports/q3.pdf",
    }),
    {
      downloadsDir: "/downloads",
      exists: (path) => path === "/downloads/q3.pdf",
    },
  );
  expect(plan.kind).toBe("write");
  if (plan.kind === "write") {
    expect(plan.path).toBe("/downloads/q3 (1).pdf");
    expect([...plan.bytes]).toEqual([9, 8, 7]);
  }
});

test("a traversal file name cannot escape the downloads directory", async () => {
  const plan = await planSaveFileRequest(
    saveRequest({ fileName: "../../../etc/passwd" }),
    { downloadsDir: "/downloads", exists: () => false },
  );
  expect(plan.kind).toBe("write");
  if (plan.kind === "write") {
    expect(plan.path).toBe("/downloads/passwd");
  }
});

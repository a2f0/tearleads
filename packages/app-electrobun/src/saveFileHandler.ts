import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  ELECTROBUN_FILE_NAME_HEADER,
  ELECTROBUN_SAVE_FILE_PATH,
} from "./saveFileBridge";

// A downloaded file's name arrives from the renderer and could contain path
// separators (a blob's name can be a raw storage key); reduce it to a single
// flat base name so a download can never escape the Downloads folder.
export function sanitizeDownloadFileName(fileName: string): string {
  const base = basename(fileName.replace(/[/\\]+/gu, "/")).trim();
  if (base.length === 0 || base === "." || base === "..") {
    return "download";
  }
  return base;
}

// Never silently overwrite an existing download: "report.pdf" that already
// exists becomes "report (1).pdf", matching how a browser deconflicts repeated
// downloads. `exists` is injectable so the dedup logic is testable without
// touching the filesystem.
export function resolveUniqueDownloadPath(
  directory: string,
  fileName: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const extension = extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  let candidate = join(directory, fileName);
  let counter = 1;
  while (exists(candidate)) {
    candidate = join(directory, `${stem} (${counter})${extension}`);
    counter += 1;
  }
  return candidate;
}

// What the Bun server should do with an incoming request, decided without any
// disk I/O beyond reading the request body: `ignore` — not our route; `reject` —
// a client error surfaced verbatim; `write` — the resolved target path and the
// posted bytes for the server to write and reveal.
type SaveFilePlan =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "reject";
      readonly status: number;
      readonly message: string;
    }
  | {
      readonly kind: "write";
      readonly path: string;
      readonly bytes: Uint8Array;
    };

// The renderer's WKWebView has no browser download destination, so the app posts
// a file's bytes to ELECTROBUN_SAVE_FILE_PATH (same origin) and the main process
// writes them to the user's Downloads folder. Requiring the file-name header
// rejects cross-origin simple POSTs, which cannot set a custom header. Pure aside
// from reading the request body, so the routing, the CSRF gate, and the path
// resolution are all unit-testable without Bun or the native bridge.
export async function planSaveFileRequest(
  req: Request,
  options: {
    readonly downloadsDir: string;
    readonly exists?: (path: string) => boolean;
  },
): Promise<SaveFilePlan> {
  const { pathname } = new URL(req.url);
  if (req.method !== "POST" || pathname !== ELECTROBUN_SAVE_FILE_PATH) {
    return { kind: "ignore" };
  }

  const rawName = req.headers.get(ELECTROBUN_FILE_NAME_HEADER);
  if (rawName === null) {
    return { kind: "reject", status: 400, message: "Missing file name" };
  }

  let decodedName: string;
  try {
    decodedName = decodeURIComponent(rawName);
  } catch {
    decodedName = "";
  }
  const fileName = sanitizeDownloadFileName(decodedName);
  const path = resolveUniqueDownloadPath(
    options.downloadsDir,
    fileName,
    options.exists,
  );
  const bytes = new Uint8Array(await req.arrayBuffer());
  return { kind: "write", path, bytes };
}

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { getSqliteWasmAssetUrl } from "@tearleads/sqlite-worker/assets";
import { serve } from "bun";
import { BrowserWindow, Utils } from "electrobun/bun";
import {
  ELECTROBUN_FILE_NAME_HEADER,
  ELECTROBUN_SAVE_FILE_PATH,
} from "../saveFileBridge";

const packageDirEnvName = "TEARLEADS_ELECTROBUN_PACKAGE_DIR";
const isDev = process.env.NODE_ENV !== "production";
// Keep Electrobun off app-web's default :3000 origin so stale app-web service
// workers cannot control the desktop dev renderer.
const devServerPort = 3002;

// A downloaded file's name arrives from the renderer and could contain path
// separators (a blob's name can be a raw storage key); reduce it to a single
// flat base name so a download can never escape the Downloads folder.
function sanitizeDownloadFileName(fileName: string): string {
  const base = basename(fileName.replace(/[/\\]+/gu, "/")).trim();
  if (base.length === 0 || base === "." || base === "..") {
    return "download";
  }
  return base;
}

// Never silently overwrite an existing download: "report.pdf" that already
// exists becomes "report (1).pdf", matching how a browser deconflicts repeated
// downloads.
function resolveUniqueDownloadPath(
  directory: string,
  fileName: string,
): string {
  const extension = extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  let candidate = join(directory, fileName);
  let counter = 1;
  while (existsSync(candidate)) {
    candidate = join(directory, `${stem} (${counter})${extension}`);
    counter += 1;
  }
  return candidate;
}

// The renderer's WKWebView has no browser download destination, so the app posts
// a file's bytes here (same origin, see src/renderer/electrobunFileSaver.ts) and
// the main process writes them to the user's Downloads folder and reveals the
// result. Requiring the file-name header rejects cross-origin simple POSTs,
// which cannot set a custom header.
async function handleSaveFileRequest(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (req.method !== "POST" || pathname !== ELECTROBUN_SAVE_FILE_PATH) {
    return null;
  }

  const rawName = req.headers.get(ELECTROBUN_FILE_NAME_HEADER);
  if (rawName === null) {
    return new Response("Missing file name", { status: 400 });
  }

  let decodedName: string;
  try {
    decodedName = decodeURIComponent(rawName);
  } catch {
    decodedName = "";
  }
  const fileName = sanitizeDownloadFileName(decodedName);
  const targetPath = resolveUniqueDownloadPath(Utils.paths.downloads, fileName);

  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    await Bun.write(targetPath, bytes);
  } catch (error) {
    console.error("electrobun: failed to save downloaded file", error);
    return new Response("Failed to save file", { status: 500 });
  }

  // Reveal where the download landed. A reveal failure must not fail the save,
  // whose bytes are already on disk.
  try {
    Utils.showItemInFolder(targetPath);
  } catch (error) {
    console.error("electrobun: failed to reveal downloaded file", error);
  }

  return Response.json({ path: targetPath });
}

function getPackageSourcePath(
  packageRelativePath: string,
  moduleRelativeUrl: string,
) {
  const packageDir = process.env[packageDirEnvName];
  if (packageDir) {
    return resolve(packageDir, packageRelativePath);
  }

  return fileURLToPath(new URL(moduleRelativeUrl, import.meta.url));
}

// Resolve the SQLite WASM binary's real path. getSqliteWasmAssetUrl() resolves
// relative to @tearleads/sqlite-instance's module URL, which is correct from
// source but breaks in the dev build: Electrobun inlines this file into the
// app bundle, so the asset URL points at <bundle>/dist/jswasm/sqlite3.wasm,
// which does not exist. Serving that missing file as a streaming Bun.file
// response hangs the worker's WebAssembly.instantiateStreaming (and wedges the
// dev server). In dev, resolve it from the workspace source like the renderer
// and worker entrypoints; otherwise fall back to the packaged asset URL.
function getSqliteWasmFilePath(): string {
  const packageDir = process.env[packageDirEnvName];
  if (packageDir) {
    return resolve(packageDir, "../sqlite-instance/dist/jswasm/sqlite3.wasm");
  }

  return fileURLToPath(getSqliteWasmAssetUrl());
}

async function isRegularFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function getPackagedViewAssetPath(viewDir: string, pathname: string) {
  const assetPathname = pathname === "/" ? "/index.html" : pathname;
  let decodedPathname: string;

  try {
    decodedPathname = decodeURIComponent(assetPathname);
  } catch {
    return null;
  }

  if (decodedPathname.includes("\0")) {
    return null;
  }

  try {
    const assetPath = resolve(viewDir, `.${decodedPathname}`);
    const relativePath = relative(viewDir, assetPath);

    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      return null;
    }

    return assetPath;
  } catch {
    return null;
  }
}

function createPackagedServerConfig() {
  const viewDir = fileURLToPath(new URL("../views/mainview/", import.meta.url));
  const indexPath = resolve(viewDir, "index.html");

  return {
    async fetch(req: Request) {
      const saveResponse = await handleSaveFileRequest(req);
      if (saveResponse) {
        return saveResponse;
      }

      const { pathname } = new URL(req.url);
      const assetPath = getPackagedViewAssetPath(viewDir, pathname);

      if (!assetPath) {
        return new Response("Not found", { status: 404 });
      }

      const fileExists = await isRegularFile(assetPath);
      if (!fileExists && /\.[a-z0-9]+$/i.test(pathname)) {
        return new Response("Not found", { status: 404 });
      }

      const responsePath = fileExists ? assetPath : indexPath;
      const responseFile = Bun.file(responsePath);

      return new Response(responseFile, {
        headers: {
          "Content-Type": responseFile.type || "application/octet-stream",
        },
      });
    },
  };
}

async function createDevServerConfig() {
  const workerEntrypoint = getPackageSourcePath(
    "src/renderer/databaseWorker.ts",
    "../renderer/databaseWorker.ts",
  );
  // Build the desktop renderer directly in dev. Reusing app-web's entrypoint
  // also reuses app-web's service-worker assumptions, which can affect the
  // desktop shell when stale :3000 browser state exists.
  const webEntrypoint = getPackageSourcePath(
    "src/renderer/index.html",
    "../renderer/index.html",
  );

  const webBuild = await Bun.build({
    entrypoints: [webEntrypoint],
    target: "browser",
    format: "esm",
  });

  if (!webBuild.success || webBuild.outputs.length === 0) {
    throw new Error("Web build failed", { cause: webBuild.logs });
  }

  const workerBuild = await Bun.build({
    entrypoints: [workerEntrypoint],
    target: "browser",
    format: "esm",
  });

  if (!workerBuild.success || workerBuild.outputs.length === 0) {
    throw new Error("Worker build failed", { cause: workerBuild.logs });
  }

  const workerScript = workerBuild.outputs[0];

  // Read the WASM into memory once. Beyond avoiding a per-request file open,
  // this makes a missing/misresolved binary fail fast at startup rather than
  // hanging every /sqlite3.wasm request (a streaming Bun.file of a nonexistent
  // path never completes).
  const sqliteWasm = await Bun.file(getSqliteWasmFilePath()).arrayBuffer();

  const webOutputs = new Map(
    webBuild.outputs.map((output) => [
      output.path === "./index.html" ? "/" : output.path.slice(1),
      output,
    ]),
  );

  const indexOutput = webOutputs.get("/");
  if (!indexOutput) {
    throw new Error("Missing built index.html response");
  }

  return {
    async fetch(req: Request) {
      const saveResponse = await handleSaveFileRequest(req);
      if (saveResponse) {
        return saveResponse;
      }

      const { pathname } = new URL(req.url);

      if (pathname === "/worker.js") {
        return new Response(workerScript, {
          headers: { "Content-Type": "application/javascript" },
        });
      }

      if (pathname === "/sqlite3.wasm") {
        return new Response(sqliteWasm, {
          headers: { "Content-Type": "application/wasm" },
        });
      }

      const webOutput = webOutputs.get(pathname) ?? indexOutput;
      return new Response(webOutput, {
        headers: { "Content-Type": webOutput.type },
      });
    },
  };
}

const appServer = serve({
  hostname: "127.0.0.1",
  port: isDev ? devServerPort : 0,
  ...(isDev ? await createDevServerConfig() : createPackagedServerConfig()),
  ...(isDev
    ? {
        development: {
          hmr: true,
          console: true,
        },
      }
    : {}),
});

console.log(`Electrobun app server running at ${appServer.url}`);

new BrowserWindow({
  title: "Tearleads",
  url: appServer.url.href,
  frame: {
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
  },
});

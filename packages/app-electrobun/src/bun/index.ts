import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getSqliteWasmAssetUrl } from "@tearleads/sqlite-worker/assets";
import { serve } from "bun";
import { BrowserWindow } from "electrobun/bun";

const packageDirEnvName = "TEARLEADS_ELECTROBUN_PACKAGE_DIR";
const isDev = process.env.NODE_ENV !== "production";
// Keep Electrobun off app-web's default :3000 origin so stale app-web service
// workers cannot control the desktop dev renderer.
const devServerPort = 3002;

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

  const sqliteWasm = Bun.file(getSqliteWasmAssetUrl());

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
  // Packaged Electrobun also serves the renderer over http://127.0.0.1, so the
  // renderer needs an explicit dev marker instead of checking protocol/origin.
  const devIndexHtml = (await indexOutput.text()).replace(
    "</head>",
    "<script>globalThis.__TEARLEADS_ELECTROBUN_DEV__ = true;</script></head>",
  );

  return {
    fetch(req: Request) {
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
      if (webOutput === indexOutput) {
        return new Response(devIndexHtml, {
          headers: { "Content-Type": webOutput.type },
        });
      }

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

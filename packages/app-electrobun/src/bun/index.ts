import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSqliteWasmAssetUrl } from "@tearleads/sqlite-worker/assets";
import { serve } from "bun";
import { BrowserWindow } from "electrobun/bun";

const packageDirEnvName = "TEARLEADS_ELECTROBUN_PACKAGE_DIR";
const isDev = process.env.NODE_ENV !== "production";

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

async function createDevServerConfig() {
  const workerEntrypoint = getPackageSourcePath(
    "src/renderer/databaseWorker.ts",
    "../renderer/databaseWorker.ts",
  );
  const webEntrypoint = getPackageSourcePath(
    "../app-web/src/index.html",
    "../../../app-web/src/index.html",
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
      return new Response(webOutput, {
        headers: { "Content-Type": webOutput.type },
      });
    },
  };
}

const devServer = isDev
  ? serve({
      port: 3000,
      ...(await createDevServerConfig()),
      development: {
        hmr: true,
        console: true,
      },
    })
  : null;

if (devServer) {
  console.log(`Electrobun dev server running at ${devServer.url}`);
}

new BrowserWindow({
  title: "Tearleads",
  url: devServer ? devServer.url.href : "views://mainview/index.html",
  frame: {
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
  },
});

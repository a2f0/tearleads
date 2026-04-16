import { serve } from "bun";
import { BrowserWindow } from "electrobun/bun";

const isDev = process.env.NODE_ENV !== "production";

function getRepoRoot() {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error("Failed to determine repository root", {
      cause: Buffer.from(result.stderr).toString(),
    });
  }

  return Buffer.from(result.stdout).toString().trim();
}

async function createDevServerConfig() {
  const repoRoot = getRepoRoot();
  const workerEntrypoint = `${repoRoot}/packages/app-electrobun/src/renderer/databaseWorker.ts`;
  const webEntrypoint = `${repoRoot}/packages/app-web/src/index.html`;

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

  const sqliteWasm = Bun.file(
    `${repoRoot}/packages/sqlite-instance/dist/jswasm/sqlite3.wasm`,
  );

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

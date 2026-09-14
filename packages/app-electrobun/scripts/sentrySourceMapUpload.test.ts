import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  desktopSourceMapUploadArgs,
  desktopSourceMapUploadEnv,
} from "./sentrySourceMaps";

const packageRoot = resolve(import.meta.dirname, "..");

// A loopback stand-in for Sentry's chunked artifact-bundle upload API.
function startFakeSentry(bundlePath: string) {
  const chunks = new Map<string, Uint8Array>();
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname.endsWith("/chunk-upload/") && request.method === "GET")
        return Response.json({
          url: new URL(
            "/api/0/organizations/test-org/chunk-upload/",
            request.url,
          ).href,
          chunkSize: 8388608,
          chunksPerRequest: 64,
          maxFileSize: 2147483648,
          maxRequestSize: 33554432,
          concurrency: 1,
          hashAlgorithm: "sha1",
          compression: [],
          accept: ["artifact_bundles", "artifact_bundles_v2", "sources"],
        });
      if (pathname.endsWith("/chunk-upload/")) {
        for (const [, value] of await request.formData()) {
          if (typeof value === "string") continue;
          const bytes = new Uint8Array(await value.arrayBuffer());
          chunks.set(createHash("sha1").update(bytes).digest("hex"), bytes);
        }
        return new Response("");
      }
      if (pathname.includes("assemble")) {
        const { chunks: ids }: { chunks: string[] } = await request.json();
        const parts = ids.map((id) => chunks.get(id));
        if (parts.some((part) => !part))
          return Response.json({ state: "not_found", missingChunks: ids });
        await Bun.write(
          bundlePath,
          Buffer.concat(parts.filter((part) => part !== undefined)),
        );
        return Response.json({ state: "ok", missingChunks: [], detail: null });
      }
      return Response.json({ detail: "not found" }, { status: 404 });
    },
  });
}

async function stageFixture(root: string, stagingDir: string) {
  await Bun.write(
    join(root, "renderer.ts"),
    "export const render = () => document.title;\nconsole.log(render());\n",
  );
  await Bun.write(
    join(root, "main.ts"),
    "export const main = () => process.pid;\nconsole.log(main());\n",
  );
  for (const [entry, naming, target] of [
    ["renderer.ts", "chunk-a1b2c3.js", "browser"],
    ["main.ts", "bun/index.js", "bun"],
  ] as const) {
    const build = await Bun.build({
      entrypoints: [join(root, entry)],
      outdir: stagingDir,
      naming,
      target,
      sourcemap: "external",
    });
    expect(build.success).toBe(true);
  }
}

test("sentry-cli publishes exactly the renderer and main-process URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-sourcemap-upload-"));
  const bundlePath = join(root, "bundle.zip");
  const server = startFakeSentry(bundlePath);
  try {
    const stagingDir = join(root, "sentry-sourcemaps");
    await stageFixture(root, stagingDir);
    const { PATH } = process.env;
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "sentry:cli",
        ...desktopSourceMapUploadArgs({
          org: "test-org",
          project: "tearleads-electrobun-staging",
          release: `tearleads-electrobun@${"b".repeat(40)}`,
          dist: "staging-app",
          directory: stagingDir,
        }),
      ],
      {
        cwd: packageRoot,
        env: {
          ...desktopSourceMapUploadEnv({ PATH, HOME: root }, "fake-token"),
          SENTRY_URL: server.url.href.replace(/\/$/u, ""),
          NO_PROXY: "127.0.0.1",
          no_proxy: "127.0.0.1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, , stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, stderr).toBe(0);
    const manifest = Bun.spawnSync([
      "unzip",
      "-p",
      bundlePath,
      "manifest.json",
    ]);
    expect(manifest.exitCode).toBe(0);
    const files: { url: string; headers?: Record<string, string> }[] =
      Object.values(JSON.parse(manifest.stdout.toString()).files);
    expect(files.map((file) => file.url).sort()).toEqual([
      "app:///bun/index.js",
      "app:///bun/index.js.map",
      "app:///chunk-a1b2c3.js",
      "app:///chunk-a1b2c3.js.map",
    ]);
    for (const file of files.filter(({ url }) => url.endsWith(".js"))) {
      const headers = Object.fromEntries(
        Object.entries(file.headers ?? {}).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      );
      const { sourcemap } = headers;
      const name = file.url.split("/").at(-1);
      expect(sourcemap).toBe(`${name}.map`);
    }
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

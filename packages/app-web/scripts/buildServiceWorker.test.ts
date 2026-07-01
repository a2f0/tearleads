import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildServiceWorker, listPrecacheFiles } from "./buildServiceWorker";

async function createDistFixture(files: Record<string, string>): Promise<{
  cleanup: () => Promise<void>;
  distUrl: URL;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), "tearleads-sw-"));
  const distDir = join(tempRoot, "dist");
  await mkdir(distDir, { recursive: true });

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = join(distDir, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, contents);
  }

  return {
    cleanup: () => rm(tempRoot, { force: true, recursive: true }),
    distUrl: pathToFileURL(`${distDir}/`),
  };
}

test("buildServiceWorker generates the offline precache contract", async () => {
  const { cleanup, distUrl } = await createDistFixture({
    "index-abc123.css": "body{}",
    "index-abc123.js": "console.log('app');",
    "index-abc123.js.map": "{}",
    "index.html": '<div id="root"></div>',
    "sqlite3.wasm": "sqlite wasm",
    "sw.js": "old worker",
    "worker.js": "worker script",
  });

  try {
    expect(await listPrecacheFiles(distUrl)).toEqual([
      "/index-abc123.css",
      "/index-abc123.js",
      "/index.html",
      "/sqlite3.wasm",
      "/worker.js",
    ]);

    const result = await buildServiceWorker(
      new URL(distUrl.href.replace(/\/$/, "")),
    );
    const generatedSource = await Bun.file(new URL("sw.js", distUrl)).text();

    expect(result.cacheName).toStartWith("tearleads-app-web-");
    expect(generatedSource).toBe(result.serviceWorkerSource);
    expect(result.serviceWorkerSource).toContain(
      'const CACHE_PREFIX = "tearleads-app-web-";',
    );
    expect(result.serviceWorkerSource).toContain(
      "key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME",
    );
    expect(result.serviceWorkerSource).toContain(
      'const APP_SHELL_URL = "/index.html";',
    );
    expect(result.serviceWorkerSource).toContain("self.skipWaiting();");
    expect(result.serviceWorkerSource).toContain("self.clients.claim()");
    expect(result.serviceWorkerSource).toContain(
      "url.origin !== self.location.origin",
    );
    expect(result.serviceWorkerSource).toContain('request.mode === "navigate"');
    expect(result.serviceWorkerSource).not.toContain("index-abc123.js.map");
    expect(() => new Function(result.serviceWorkerSource)).not.toThrow();
  } finally {
    await cleanup();
  }
});

test("buildServiceWorker fails when offline-critical assets are absent", async () => {
  const { cleanup, distUrl } = await createDistFixture({
    "index.html": '<div id="root"></div>',
  });

  try {
    await expect(buildServiceWorker(distUrl)).rejects.toThrow(
      "Service worker precache is missing /worker.js and /sqlite3.wasm - run buildStaticAssets first.",
    );
  } finally {
    await cleanup();
  }
});

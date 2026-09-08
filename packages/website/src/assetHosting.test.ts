import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

async function readReadyUrl(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`Wrangler exited before listening: ${output}`);
      output += decoder.decode(value, { stream: true });
      const match = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match?.[1]) return match[1];
    }
  } finally {
    reader.releaseLock();
  }
}

for (const tier of ["staging", "prod"]) {
  test(`${tier} serves real asset rules with revalidating pages and versioned images`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "tearleads-asset-hosting-"));
    const website = resolve(import.meta.dir, "..");
    const assets = resolve(root, "assets");
    await mkdir(assets);
    await cp(resolve(website, "public/_headers"), resolve(assets, "_headers"));
    for (const [path, content] of [
      ["index.html", "<html>website fixture</html>"],
      ["features/index.html", "<html>feature fixture</html>"],
      ["screenshot-gallery/manifest.json", '{"entries":[]}'],
      ["screenshot-gallery/img/ipad/light/example.png", "image fixture"],
      ["_astro/app.abc123.js", "console.log('fixture')"],
      ["favicon.svg", "<svg />"],
    ]) {
      const file = resolve(assets, path);
      await mkdir(dirname(file), { recursive: true });
      await Bun.write(file, content);
    }
    const child = Bun.spawn(
      [
        resolve(website, "node_modules/.bin/wrangler"),
        "dev",
        "--config",
        resolve(website, "wrangler.jsonc"),
        "--env",
        tier,
        "--assets",
        assets,
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        "0",
        "--persist-to",
        resolve(root, "state"),
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          CI: "true",
          WRANGLER_SEND_METRICS: "false",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stderr = new Response(child.stderr).text();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const base = await Promise.race([
        readReadyUrl(child.stdout),
        child.exited.then(async (code) => {
          throw new Error(`Wrangler exited (${code}): ${await stderr}`);
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Wrangler startup timed out")),
            20_000,
          );
        }),
      ]);
      for (const [path, status, policy] of [
        ["/", 200, "public, no-cache, must-revalidate"],
        ["/features/", 200, "public, no-cache, must-revalidate"],
        [
          "/screenshot-gallery/manifest.json",
          200,
          "public, no-cache, must-revalidate",
        ],
        [
          "/screenshot-gallery/img/ipad/light/example.png?v=abc123",
          200,
          "public, max-age=31536000, immutable",
        ],
        ["/_astro/app.abc123.js", 200, "public, max-age=31536000, immutable"],
        ["/favicon.svg", 200, "public, no-cache, must-revalidate"],
        ["/missing-page", 404, null],
      ] as const) {
        const response = await fetch(new URL(path, base), {
          signal: AbortSignal.timeout(5000),
        });
        await response.arrayBuffer();
        expect(response.status, path).toBe(status);
        if (policy)
          expect(response.headers.get("Cache-Control"), path).toBe(policy);
      }
    } finally {
      clearTimeout(timer);
      child.kill("SIGINT");
      await child.exited;
      await stderr;
      await rm(root, { recursive: true, force: true });
    }
  }, 40_000);
}

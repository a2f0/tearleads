import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { releaseNotice } from "./config";

// Builds the site against a fixture gallery (WEBSITE_PUBLIC_DIR), so the Home
// carousel renders from a populated manifest without touching public/.
const website = resolve(import.meta.dir, "..");
let root = "";
let home = "";
let gallery = "";

// The PNG signature plus an IHDR chunk: the staging script reads only the
// width and height from the first 24 bytes.
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

async function run(command: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: website,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tearleads-home-carousel-"));
  // Mobile captures, as the capture run names its directories: light explorer
  // and notes, a dark explorer, and a contacts capture in dark only.
  for (const [theme, name] of [
    ["light", "explorer"],
    ["dark", "explorer"],
    ["light", "notes"],
    ["dark", "contacts"],
  ] as const) {
    const directory = join(root, "captures", "mobile", theme);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${name}.png`), pngHeader(1170, 1992));
  }
  const publicDir = join(root, "public");
  await run([process.execPath, "scripts/buildScreenshots.ts"], {
    SCREENSHOTS_CAPTURE_DIR: join(root, "captures"),
    SCREENSHOTS_OUTPUT_DIR: join(publicDir, "screenshot-gallery"),
  });
  const output = join(root, "dist");
  await run(
    [resolve(website, "node_modules/.bin/astro"), "build", "--outDir", output],
    {
      ASTRO_TELEMETRY_DISABLED: "1",
      NODE_ENV: "test",
      PUBLIC_ENVIRONMENT: "",
      WEBSITE_PUBLIC_DIR: publicDir,
    },
  );
  home = await Bun.file(join(output, "index.html")).text();
  gallery = await Bun.file(join(output, "screenshots", "index.html")).text();
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("the Home carousel shows phones with light captures, in order", () => {
  expect(home).toContain("data-phone-carousel");
  const sources = [
    ...home.matchAll(/<img src="(\/screenshot-gallery\/img\/[^"]+)"/g),
  ].map((match) => match[1] ?? "");
  expect(sources).toHaveLength(2);
  expect(sources[0]).toContain("explorer");
  expect(sources[1]).toContain("notes");
  // Contacts has no light capture, so it is left out.
  expect(home).not.toContain("Contacts on a phone");
  expect(home).toContain('media="(prefers-color-scheme: dark)"');
  expect(home).toContain('href="/screenshots/mobile/explorer/"');
});

test("the step buttons stay hidden until the script wires them", () => {
  expect(home).toMatch(/class="phone-carousel-steps"[^>]*\shidden/);
  expect(home).toContain('aria-label="Previous screens"');
  expect(home).toContain('aria-label="Next screens"');
});

test("the screenshot gallery carries the release notice", () => {
  if (releaseNotice === null) return;
  expect(gallery).toContain(releaseNotice);
});

import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const website = resolve(import.meta.dir, "..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// The signature plus an IHDR chunk: all the staging script reads is the first
// 24 bytes, where IHDR stores width and height as big-endian uint32s.
function pngHeader(width: number, height: number, chunkType = "IHDR") {
  const bytes = new Uint8Array(33);
  const view = new DataView(bytes.buffer);
  bytes.set(PNG_SIGNATURE, 0);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode(chunkType), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

// Captures are keyed by the capture runner's directory names (web, mobile,
// ipad), as packages/app-web/screenshots/capture.spec.ts writes them.
async function stageScreenshots(files: Record<string, Uint8Array>) {
  const root = await mkdtemp(join(tmpdir(), "tearleads-screenshots-"));
  roots.push(root);
  const captures = join(root, "captures");
  const output = join(root, "output");
  for (const [relativePath, bytes] of Object.entries(files)) {
    const file = join(captures, relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  const child = Bun.spawn([process.execPath, "scripts/buildScreenshots.ts"], {
    cwd: website,
    env: {
      ...process.env,
      SCREENSHOTS_CAPTURE_DIR: captures,
      SCREENSHOTS_OUTPUT_DIR: output,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, log: `${stdout}\n${stderr}`, output };
}

test("staged captures record their PNG pixel size in the manifest", async () => {
  const { code, log, output } = await stageScreenshots({
    "web/light/explorer.png": pngHeader(2880, 1658),
    "mobile/dark/explorer.png": pngHeader(1170, 1992),
    // Non-canonical screens and non-PNG files are not staged.
    "ipad/light/unlisted-screen.png": pngHeader(1, 1),
    "web/light/notes.txt": new TextEncoder().encode("not a capture"),
  });
  expect(code, log).toBe(0);
  const manifest = await Bun.file(join(output, "manifest.json")).json();
  expect(manifest).toMatchObject({
    projects: ["windowed", "mobile"],
    themes: ["light", "dark"],
    screens: ["explorer"],
  });
  expect(manifest.entries).toMatchObject([
    {
      project: "windowed",
      theme: "light",
      name: "explorer",
      width: 2880,
      height: 1658,
    },
    {
      project: "mobile",
      theme: "dark",
      name: "explorer",
      width: 1170,
      height: 1992,
    },
  ]);
  for (const entry of manifest.entries) {
    expect(entry.src).toMatch(
      /^\/screenshot-gallery\/img\/[a-z]+\/[a-z]+\/explorer\.png\?v=[0-9a-f]{8}$/,
    );
  }
  expect(existsSync(join(output, "img/windowed/light/explorer.png"))).toBe(
    true,
  );
});

test("household and tracker captures are included in the website gallery", async () => {
  const names = [
    "family-photo-1",
    "family-photo-2",
    "tool-detail-1",
    "tool-detail-2",
    "appliance-detail-1",
    "appliance-detail-2",
    "tool-receipt",
    "appliance-receipt",
    "weight-detail",
    "blood-pressure-detail",
  ];
  const { code, log, output } = await stageScreenshots(
    Object.fromEntries(
      names.map((name) => [`web/light/${name}.png`, pngHeader(1440, 900)]),
    ),
  );
  expect(code, log).toBe(0);
  const manifest = await Bun.file(join(output, "manifest.json")).json();
  expect(manifest.screens).toEqual(names);
  expect(manifest.entries).toHaveLength(names.length);
});

test("truncated or non-PNG captures fail staging before the gallery changes", async () => {
  const jpeg = new Uint8Array(40);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
  for (const [label, bytes] of [
    ["truncated header", pngHeader(2880, 1658).slice(0, 20)],
    ["JPEG bytes", jpeg],
    ["first chunk is not IHDR", pngHeader(2880, 1658, "IDAT")],
  ] as const) {
    const { code, log, output } = await stageScreenshots({
      "web/light/explorer.png": bytes,
    });
    expect(code, label).not.toBe(0);
    expect(log, label).toContain("is not a PNG image");
    expect(existsSync(join(output, "manifest.json")), label).toBe(false);
  }
});

test("no captures stage an empty manifest", async () => {
  const { code, log, output } = await stageScreenshots({});
  expect(code, log).toBe(0);
  expect(await Bun.file(join(output, "manifest.json")).json()).toEqual({
    projects: [],
    themes: [],
    screens: [],
    entries: [],
  });
});

test("passport captures are included in the website gallery", async () => {
  const { code, log, output } = await stageScreenshots({
    "web/light/passport-detail.png": pngHeader(2880, 1658),
    "ipad/dark/passport-detail.png": pngHeader(1668, 2388),
    "mobile/light/passport-detail.png": pngHeader(1170, 1992),
  });
  expect(code, log).toBe(0);
  const manifest = await Bun.file(join(output, "manifest.json")).json();
  expect(manifest.screens).toEqual(["passport-detail"]);
  expect(manifest.projects).toEqual(["windowed", "mobile", "tablet"]);
  expect(manifest.entries).toHaveLength(3);
  expect(existsSync(join(output, "img/tablet/dark/passport-detail.png"))).toBe(
    true,
  );
});

test("wallet detail and specimen captures are staged for every platform and theme", async () => {
  const files: Record<string, Uint8Array> = {};
  const screens = [
    "credit-card-detail",
    "birth-certificate-detail",
    "birth-certificate-image",
    "credit-card-image",
  ];
  for (const project of ["web", "mobile", "ipad"]) {
    for (const theme of ["light", "dark"]) {
      for (const screen of screens)
        files[`${project}/${theme}/${screen}.png`] = pngHeader(1440, 900);
    }
  }
  const { code, log, output } = await stageScreenshots(files);
  expect(code, log).toBe(0);
  const manifest = await Bun.file(join(output, "manifest.json")).json();
  expect(manifest.screens).toEqual(screens);
  expect(manifest.entries).toHaveLength(24);
  expect(manifest.projects).toEqual(["windowed", "mobile", "tablet"]);
  expect(manifest.themes).toEqual(["light", "dark"]);
});

test("staging refuses an unfinished or uncommitted shared capture", async () => {
  for (const [label, record, message] of [
    ["running", { status: "running" }, "capture is running"],
    ["failed", { status: "failed" }, "capture is failed"],
    [
      "dirty",
      { status: "complete", commit: "0123456789abcdef", dirty: true },
      "captured from uncommitted changes",
    ],
  ] as const) {
    const { code, log, output } = await stageScreenshots({
      "web/light/explorer.png": pngHeader(2880, 1658),
      "capture.json": new TextEncoder().encode(JSON.stringify(record)),
    });
    expect(code, label).not.toBe(0);
    expect(log, label).toContain(message);
    expect(existsSync(join(output, "manifest.json")), label).toBe(false);
  }
});

test("staging a complete shared capture logs its commit", async () => {
  const { code, log, output } = await stageScreenshots({
    "web/light/explorer.png": pngHeader(2880, 1658),
    "capture.json": new TextEncoder().encode(
      JSON.stringify({
        status: "complete",
        commit: "0123456789abcdef",
        dirty: false,
        finishedAt: "2026-10-30T12:00:00.000Z",
      }),
    ),
  });
  expect(code, log).toBe(0);
  expect(log).toContain(
    "Screenshots from 0123456789, captured 2026-10-30T12:00:00.000Z.",
  );
  expect(existsSync(join(output, "img/windowed/light/explorer.png"))).toBe(
    true,
  );
});

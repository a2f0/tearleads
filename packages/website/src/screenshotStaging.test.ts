import { afterAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  parseScreenshotManifest,
  type ScreenshotManifest,
} from "@a2f0/agent-tool/screenshots/manifest";
import { pngHeader, stageScreenshots } from "./stageScreenshots.testUtils";

// `agent-tool screenshots build website` with this repository's screenshots
// configuration (agent-tool.json): the capture's directory names map to the
// website's layout names, which its /screenshots/<layout>/<screen>/ URLs keep,
// and the shared-capture guard refuses captures a build must not publish.

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function stage(files: Record<string, Uint8Array | string>) {
  const staged = await stageScreenshots(files);
  roots.push(staged.root);
  return staged;
}

async function manifestAt(output: string): Promise<ScreenshotManifest> {
  return parseScreenshotManifest(
    await Bun.file(join(output, "manifest.json")).json(),
  );
}

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const record = (fields: object) =>
  new TextEncoder().encode(JSON.stringify(fields));

test("captures stage under the website's layout names with their PNG sizes", async () => {
  const { code, log, output } = await stage({
    "web/light/passport-detail.png": pngHeader(2880, 1658),
    "ipad/dark/passport-detail.png": pngHeader(1668, 2388),
    "mobile/light/passport-detail.png": pngHeader(1170, 2532),
  });
  expect(code, log).toBe(0);
  const manifest = await manifestAt(output);
  expect(manifest.projects).toEqual([
    { name: "windowed", label: "Desktop" },
    { name: "mobile", label: "Phone", frame: "phone" },
    { name: "tablet", label: "Tablet" },
  ]);
  expect(manifest.screens.map((screen) => screen.name)).toEqual([
    "passport-detail",
  ]);
  const phone = manifest.entries.find((entry) => entry.project === "mobile");
  expect(phone).toMatchObject({ width: 1170, height: 2532 });
  expect(phone?.src).toMatch(
    /^\/screenshot-gallery\/img\/mobile\/light\/passport-detail\.png\?v=[0-9a-f]{8}$/,
  );
  expect(existsSync(join(output, "img/tablet/dark/passport-detail.png"))).toBe(
    true,
  );
});

test("every captured product screen is listed, in the gallery's order", async () => {
  const names = [
    "home",
    "explorer",
    "contacts",
    "org-manager",
    "org-manager-roster",
    "org-manager-groups",
    "org-manager-grants",
    "org-manager-organization",
    "org-manager-usage",
    "org-manager-billing",
    "notes",
    "identity-manager",
    "backup-restore",
    "system-monitor",
    "note-detail",
    "note-blame",
    "contact-detail",
    "drivers-license-detail",
    "passport-detail",
    "credit-card-detail",
    "birth-certificate-detail",
    "birth-certificate-image",
    "credit-card-image",
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
  const { code, log, output } = await stage(
    Object.fromEntries(
      [...names]
        .reverse()
        .map((name) => [`mobile/dark/${name}.png`, pngHeader(1170, 2532)]),
    ),
  );
  expect(code, log).toBe(0);
  const manifest = await manifestAt(output);
  expect(manifest.screens.map((screen) => screen.name)).toEqual(names);
  expect(manifest.entries).toHaveLength(names.length);
  expect(
    manifest.screens.find((screen) => screen.name === "drivers-license-detail")
      ?.label,
  ).toBe("Driver's license");
});

test("no captures stage an empty manifest", async () => {
  const { code, log, output } = await stage({});
  expect(code, log).toBe(0);
  const manifest = await manifestAt(output);
  expect(manifest.entries).toEqual([]);
  expect(manifest.projects).toEqual([]);
});

test("staging refuses an unfinished or uncommitted shared capture", async () => {
  for (const [label, fields, message] of [
    ["running", { status: "running" }, "capture is running"],
    ["failed", { status: "failed" }, "capture is failed"],
    [
      "dirty",
      { status: "complete", commit: COMMIT, dirty: true },
      "captured from uncommitted changes",
    ],
    [
      "no commit",
      { status: "complete", dirty: false },
      "record names no commit",
    ],
  ] as const) {
    const { code, log, output } = await stage({
      "web/light/explorer.png": pngHeader(2880, 1658),
      "capture.json": record(fields),
    });
    expect(code, label).not.toBe(0);
    expect(log, label).toContain(message);
    expect(existsSync(join(output, "manifest.json")), label).toBe(false);
  }
});

test("staging a complete shared capture logs its commit", async () => {
  const { code, log, output } = await stage({
    "web/light/explorer.png": pngHeader(2880, 1658),
    "capture.json": record({
      status: "complete",
      commit: COMMIT,
      dirty: false,
      finishedAt: "2026-10-30T12:00:00.000Z",
    }),
  });
  expect(code, log).toBe(0);
  expect(log).toContain(
    "Screenshots from 0123456789, captured 2026-10-30T12:00:00.000Z.",
  );
  expect((await manifestAt(output)).capture).toEqual({
    commit: COMMIT,
    finishedAt: "2026-10-30T12:00:00.000Z",
  });
  expect(existsSync(join(output, "img/windowed/light/explorer.png"))).toBe(
    true,
  );
});

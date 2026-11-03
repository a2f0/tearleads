import { afterAll, beforeAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { releaseNotice } from "./config";
import { pngHeader, stageScreenshots } from "./stageScreenshots.testUtils";

// Builds the site against a fixture gallery (WEBSITE_PUBLIC_DIR), staged by
// agent-tool with this repository's configuration, so the Home carousel and
// the gallery render from a populated manifest without touching public/.
const website = resolve(import.meta.dir, "..");
let root = "";
let home = "";
let gallery = "";
let screen = "";
let output = "";

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
  // Mobile captures: light and dark explorer, light notes, and contacts in
  // dark only; a desktop capture that the phone row must leave out.
  const phone = pngHeader(1170, 2532);
  const staged = await stageScreenshots({
    "mobile/light/explorer.png": phone,
    "mobile/dark/explorer.png": phone,
    "mobile/light/notes.png": phone,
    "mobile/dark/contacts.png": phone,
    "web/light/home.png": pngHeader(2880, 1658),
  });
  root = staged.root;
  expect(staged.code, staged.log).toBe(0);
  output = join(root, "dist");
  await run(
    [resolve(website, "node_modules/.bin/astro"), "build", "--outDir", output],
    {
      ASTRO_TELEMETRY_DISABLED: "1",
      NODE_ENV: "test",
      PUBLIC_ENVIRONMENT: "",
      WEBSITE_PUBLIC_DIR: staged.publicDir,
    },
  );
  home = await Bun.file(join(output, "index.html")).text();
  gallery = await Bun.file(join(output, "screenshots", "index.html")).text();
  screen = await Bun.file(
    join(output, "screenshots", "mobile", "notes", "index.html"),
  ).text();
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function phoneImages(page: string): string[] {
  return [
    ...page.matchAll(/<img src="\/screenshot-gallery\/img\/mobile\/[^>]+>/g),
  ].map((match) => match[0]);
}

test("the Home carousel renders every phone screen, in manifest order", () => {
  expect(home).toContain("<screenshot-carousel");
  expect(home).toContain('manifest="/screenshot-gallery/manifest.json"');
  const images = phoneImages(home);
  expect(images).toHaveLength(3);
  expect(images[0]).toContain("/light/explorer.png");
  // Contacts has no light capture, so its dark capture is the image.
  expect(images[1]).toContain("/dark/contacts.png");
  expect(images[2]).toContain("/light/notes.png");
  expect(home).not.toContain("/screenshot-gallery/img/windowed/");
  expect(home).toContain('media="(prefers-color-scheme: dark)"');
  expect(home).toContain('href="/screenshots/mobile/explorer/"');
  expect(home).toContain("<figcaption>Notes</figcaption>");
  expect(home).toContain(
    'alt="Notes: a list of notes with the time each was modified."',
  );
});

test("the carousel's own controls row carries the All screenshots link", () => {
  // agent-tool renders it from view-all-href; the static markup repeats the
  // row so the link is there before the element upgrades and without script.
  expect(home).toContain('view-all-href="/screenshots/mobile/explorer/"');
  expect(home).toContain('view-all-label="All screenshots"');
  const links = [
    ...home.matchAll(
      /<a class="shots-carousel-view-all" href="([^"]+)">([^<]+)<\/a>/g,
    ),
  ];
  expect(links.map((match) => [match[1], match[2]])).toEqual([
    ["/screenshots/mobile/explorer/", "All screenshots"],
  ]);
  expect(home).not.toContain("phone-carousel-all");
});

test("only the first phone loads eagerly, and every phone declares its size", () => {
  const images = phoneImages(home);
  expect(images[0]).toContain('loading="eager"');
  expect(images[0]).toContain('fetchpriority="high"');
  for (const image of images.slice(1)) {
    expect(image).toContain('loading="lazy"');
    expect(image).not.toContain('fetchpriority="high"');
  }
  for (const image of images) {
    expect(image).toContain('width="1170" height="2532"');
    expect(image).toContain('decoding="async"');
  }
});

test("the gallery page renders agent-tool's gallery with Tearleads titles", () => {
  expect(gallery).toContain("<screenshot-gallery");
  expect(gallery).toContain('base-path="/screenshots"');
  expect(gallery).toContain('heading-id="page-title"');
  expect(gallery).toContain('title-template="{heading} | Tearleads"');
  expect(screen).toContain('initial-project="mobile"');
  expect(screen).toContain('initial-screen="notes"');
  expect(screen).toContain(
    "<title>Notes, phone screenshot | Tearleads</title>",
  );
});

// The module scripts a page loads, other than the shared layout's.
function pageScripts(page: string): string[] {
  return [...page.matchAll(/<script type="module" src="(\/_astro\/[^"]+)"/g)]
    .map((match) => match[1] ?? "")
    .filter((src) => !src.startsWith("/_astro/Layout."));
}

test("each page's own script registers the shared elements", async () => {
  for (const [page, tag] of [
    [home, "screenshot-carousel"],
    [gallery, "screenshot-gallery"],
  ] as const) {
    const scripts = pageScripts(page);
    expect(scripts.length, tag).toBeGreaterThan(0);
    GlobalRegistrator.register({ url: "https://tearleads.test/" });
    try {
      for (const src of scripts) await import(join(output, src));
      expect(customElements.get(tag), tag).toBeDefined();
    } finally {
      await GlobalRegistrator.unregister();
    }
  }
});

test("a screen page's heading names its screen; the index keeps its own", () => {
  expect(screen).toContain(
    '<h1 id="page-title" class="site-h1">Notes, phone screenshot</h1>',
  );
  expect(gallery).toContain(
    '<h1 id="page-title" class="site-h1">Screenshots</h1>',
  );
});

test("the screenshot gallery carries the release notice", () => {
  if (releaseNotice === null) return;
  expect(gallery).toContain(releaseNotice);
});

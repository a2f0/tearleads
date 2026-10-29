import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { docPath, technicalDocs } from "./technicalDocs";

/**
 * Builds the site once and checks the published technical documents as
 * rendered: links rewritten off the repository, fragments that resolve, and
 * tables in their scroll regions. Whether a GitHub target exists is checked
 * on the source Markdown by `bun run lint:doc-links`, which reads the whole
 * repository and so stays out of this package's cached test task.
 */

const website = resolve(import.meta.dir, "..");
let output = "";
const pages = new Map<string, string>();

beforeAll(async () => {
  // Direct Astro builds skip prebuild; stage what it would (seoBuild.test.ts).
  for (const command of [
    [process.execPath, "run", "images"],
    [process.execPath, "scripts/buildScreenshots.ts"],
  ]) {
    const preparation = Bun.spawnSync(command, {
      cwd: website,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(preparation.exitCode, preparation.stderr.toString()).toBe(0);
  }
  output = await mkdtemp(resolve(tmpdir(), "tearleads-docs-build-"));
  const child = Bun.spawn(
    [resolve(website, "node_modules/.bin/astro"), "build", "--outDir", output],
    {
      cwd: website,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PUBLIC_ENVIRONMENT: "production",
        PUBLIC_STRIPE_CUSTOMER_PORTAL_URL:
          "https://billing.stripe.com/p/login/test",
        ASTRO_TELEMETRY_DISABLED: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  expect(code, stderr).toBe(0);
  for (const path of ["/docs/", "/security/", ...technicalDocs.map(docPath)]) {
    pages.set(
      path,
      await Bun.file(resolve(output, `.${path}index.html`)).text(),
    );
  }
}, 120_000);

afterAll(async () => {
  if (output !== "") await rm(output, { recursive: true, force: true });
});

function hrefs(html: string): string[] {
  return [...html.matchAll(/\shref="([^"]*)"/g)].map((match) => match[1] ?? "");
}

function ids(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1] ?? ""),
  );
}

test("published documents keep no repository-relative links", () => {
  for (const doc of technicalDocs) {
    const html = pages.get(docPath(doc)) ?? "";
    const relative = hrefs(html).filter(
      (href) => !/^(?:https?:|mailto:|\/|#)/.test(href),
    );
    expect(relative, doc.slug).toEqual([]);
  }
});

test("links between published documents reach a rendered anchor", () => {
  const misses: string[] = [];
  for (const doc of technicalDocs) {
    const path = docPath(doc);
    const html = pages.get(path) ?? "";
    for (const href of hrefs(html)) {
      const match = /^(\/docs\/[^#]*)?#(.+)$/.exec(href);
      if (match === null) continue;
      const target = match[1] ?? path;
      const targetHtml = pages.get(target);
      if (targetHtml === undefined || !ids(targetHtml).has(match[2] ?? "")) {
        misses.push(`${path} -> ${href}`);
      }
    }
  }
  expect(misses).toEqual([]);
});

test("cipher suites renders code links, page links, and table regions", () => {
  const html = pages.get("/docs/cipher-suites/") ?? "";
  expect(html).toContain(
    'href="https://github.com/a2f0/tearleads/blob/main/packages/client-sdk/src/data/containers/shared/projection.ts"',
  );
  expect(html).toContain('href="/docs/keying-design/"');
  expect(html).toMatch(
    /<div class="docs-table" role="region" tabindex="0" aria-label="Table \(scrolls horizontally\)"><table>/,
  );
  // The source h1 becomes an anchor so #cipher-suites links still land.
  expect(ids(html).has("cipher-suites")).toBe(true);
  expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
});

test("the security page and index link every published document", () => {
  for (const path of ["/security/", "/docs/"]) {
    const links = new Set(hrefs(pages.get(path) ?? ""));
    for (const doc of technicalDocs) {
      expect(links.has(docPath(doc)), `${path} -> ${doc.slug}`).toBe(true);
    }
  }
});

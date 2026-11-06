import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseApiDocument } from "./apiReference/openApiDocument";
import {
  apiReferenceListing,
  docPath,
  publishedDocs,
  technicalDocPages,
  technicalDocs,
} from "./technicalDocs";

/**
 * Builds the site once and checks the published technical documents as
 * rendered: links rewritten off the repository, fragments that resolve, and
 * tables in their scroll regions. Whether a GitHub target exists is checked
 * on the source Markdown by `bun run lint:doc-links`, which reads the whole
 * repository and so stays out of this package's cached test task.
 *
 * It also checks the API reference rendered from docs/openapi.json: a page
 * per operation and schema, every link on those pages reaching a built page
 * and anchor, and /openapi.json serving the document's exact bytes.
 */

const website = resolve(import.meta.dir, "..");
let output = "";
const pages = new Map<string, string>();
const apiPages = new Map<string, string>();
const openApiSource = resolve(website, "../../docs/openapi.json");

beforeAll(async () => {
  // Direct Astro builds skip prebuild; stage what it would (seoBuild.test.ts).
  for (const command of [
    [process.execPath, "run", "images"],
    [process.execPath, "run", "screenshots"],
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
  // Drain both pipes so a full stdout buffer cannot stall the build.
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
  for (const path of ["/docs/", "/security/", ...publishedDocs.map(docPath)]) {
    pages.set(
      path,
      await Bun.file(resolve(output, `.${path}index.html`)).text(),
    );
  }
  const apiRoot = resolve(output, "docs/api");
  for (const file of await readdir(apiRoot, { recursive: true })) {
    if (!file.endsWith("index.html")) continue;
    const path = `/docs/api/${file.slice(0, -"index.html".length)}`;
    apiPages.set(path, await Bun.file(resolve(apiRoot, file)).text());
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
  for (const doc of publishedDocs) {
    const html = pages.get(docPath(doc)) ?? "";
    const relative = hrefs(html).filter(
      (href) => !/^(?:https?:|mailto:|\/|#)/.test(href),
    );
    expect(relative, doc.slug).toEqual([]);
  }
});

test("links between published documents reach a rendered anchor", () => {
  const misses: string[] = [];
  for (const doc of publishedDocs) {
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

test("topic pages name their document in the breadcrumb", () => {
  for (const page of technicalDocPages) {
    const html = pages.get(docPath(page)) ?? "";
    const breadcrumb =
      /<nav class="site-breadcrumb"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
    expect(hrefs(breadcrumb ?? ""), page.slug).toContain(
      `/docs/${page.parent}/`,
    );
  }
});

test("the security page and index link every published document", () => {
  for (const path of ["/security/", "/docs/"]) {
    const links = new Set(hrefs(pages.get(path) ?? ""));
    for (const doc of technicalDocs) {
      expect(links.has(docPath(doc)), `${path} -> ${doc.slug}`).toBe(true);
    }
  }
});

test("the API reference has a page per operation and per schema", async () => {
  const document = parseApiDocument(await readFile(openApiSource, "utf8"));
  expect(apiPages.size).toBe(
    1 + document.operations.length + document.schemas.size,
  );
  for (const name of document.schemas.keys()) {
    expect(apiPages.has(`/docs/api/schemas/${name}/`), name).toBe(true);
  }
});

test("/openapi.json serves docs/openapi.json byte for byte", async () => {
  const served = await readFile(resolve(output, "openapi.json"));
  expect(served.equals(await readFile(openApiSource))).toBe(true);
});

test("every link on the API reference reaches a built page and anchor", async () => {
  const misses: string[] = [];
  const built = async (target: string) =>
    pages.get(target) ??
    apiPages.get(target) ??
    (await Bun.file(resolve(output, `.${target}index.html`))
      .text()
      .catch(() => undefined));
  for (const [path, html] of apiPages) {
    for (const href of hrefs(html)) {
      if (/^(?:https?:|mailto:)/.test(href)) continue;
      const [target = "", fragment] = href.split("#");
      if (/\.[a-z0-9]+$/i.test(target)) {
        const exists = await Bun.file(resolve(output, `.${target}`)).exists();
        if (!exists) misses.push(`${path} -> ${href}`);
        continue;
      }
      const targetHtml = target === "" ? html : await built(target);
      if (
        targetHtml === undefined ||
        (!target.endsWith("/") && target !== "") ||
        (fragment !== undefined && !ids(targetHtml).has(fragment))
      ) {
        misses.push(`${path} -> ${href}`);
      }
    }
  }
  expect(misses).toEqual([]);
  // Glossary terms link to the published glossary's anchors.
  const index = apiPages.get("/docs/api/") ?? "";
  expect(index).toMatch(
    /class="api-term" href="\/docs\/glossary\/[a-z-]+\/#[a-z-]+"/,
  );
  expect(hrefs(index)).toContain("/openapi.json");
  expect(hrefs(index)).toContain("/docs/protocol-specification/");
});

test("the docs index and security page list the API reference", () => {
  for (const path of ["/security/", "/docs/"]) {
    expect(hrefs(pages.get(path) ?? "")).toContain(apiReferenceListing.path);
  }
});

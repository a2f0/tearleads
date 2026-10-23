import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  canonicalUrl,
  robotsTxt,
  socialImage,
  stagingRobotsHeader,
  withStagingNoindex,
} from "./seo";

const website = resolve(import.meta.dir, "..");

beforeAll(() => {
  // Direct Astro builds skip prebuild; stage the screenshot manifest it needs.
  const preparation = Bun.spawnSync(
    [process.execPath, "scripts/buildScreenshots.ts"],
    { cwd: website, stdout: "pipe", stderr: "pipe" },
  );
  expect(
    preparation.exitCode,
    `${preparation.stdout.toString()}\n${preparation.stderr.toString()}`,
  ).toBe(0);
});

async function build(environment: "production" | "staging", output: string) {
  const child = Bun.spawn(
    [resolve(website, "node_modules/.bin/astro"), "build", "--outDir", output],
    {
      cwd: website,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PUBLIC_ENVIRONMENT: environment,
        PUBLIC_STRIPE_CUSTOMER_PORTAL_URL:
          "https://billing.stripe.com/p/login/test",
        ASTRO_TELEMETRY_DISABLED: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}

/** Every built page, keyed by its site path, e.g. "/pricing/". */
async function builtPages(output: string): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  for (const file of await readdir(output, { recursive: true })) {
    if (!file.endsWith("index.html")) continue;
    const path = `/${file.slice(0, -"index.html".length)}`;
    pages.set(path, await Bun.file(resolve(output, file)).text());
  }
  return pages;
}

for (const environment of ["production", "staging"] as const) {
  test(`${environment} builds publish their tier's crawler metadata`, async () => {
    const output = await mkdtemp(resolve(tmpdir(), "tearleads-seo-build-"));
    try {
      await build(environment, output);
      const staging = environment === "staging";
      const pages = await builtPages(output);
      expect(pages.has("/")).toBe(true);
      for (const [path, html] of pages) {
        // Staging pages name no URL; production pages name their own.
        const canonical = canonicalUrl(path);
        expect(
          html.includes(`<link rel="canonical" href="${canonical}">`),
          path,
        ).toBe(!staging);
        expect(
          html.includes(`<meta property="og:url" content="${canonical}">`),
          path,
        ).toBe(!staging);
        if (staging) {
          expect(html, path).not.toContain('rel="canonical"');
          expect(html, path).not.toContain('property="og:url"');
        }
        expect(html, path).toContain(
          `<meta property="og:image" content="${socialImage.url}">`,
        );
        expect(html, path).toContain(
          '<meta name="twitter:card" content="summary_large_image">',
        );
        expect(
          html.includes('<meta name="robots" content="noindex, nofollow">'),
          path,
        ).toBe(staging);
        if (!staging) expect(html, path).not.toContain('name="robots"');
      }
      const home = pages.get("/") ?? "";
      const graph = home.match(
        /<script type="application\/ld\+json">(.*?)<\/script>/s,
      )?.[1];
      expect(JSON.parse(graph ?? "null")["@graph"]).toHaveLength(3);

      expect(await Bun.file(resolve(output, "robots.txt")).text()).toBe(
        robotsTxt(!staging),
      );
      const headers = await Bun.file(resolve(output, "_headers")).text();
      const publicHeaders = await Bun.file(
        resolve(website, "public/_headers"),
      ).text();
      expect(headers).toBe(
        staging ? withStagingNoindex(publicHeaders) : publicHeaders,
      );
      expect(headers.includes(stagingRobotsHeader)).toBe(staging);
      const sitemap = Bun.file(resolve(output, "sitemap.xml"));
      expect(await sitemap.exists()).toBe(!staging);
      if (!staging) {
        const locations = [
          ...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g),
        ].map((match) => match[1]);
        expect(locations).toEqual([...pages.keys()].map(canonicalUrl).sort());
      }
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }, 30_000);
}

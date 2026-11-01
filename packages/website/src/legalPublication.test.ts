import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { releaseNotice } from "./config";
import { legalDetails } from "./legal";

const website = resolve(import.meta.dir, "..");

beforeAll(() => {
  // Direct Astro builds skip prebuild; stage its required manifest even on CI
  // checkouts with no captured screenshots or generated public assets.
  const preparation = Bun.spawnSync(
    [process.execPath, "scripts/buildScreenshots.ts"],
    { cwd: website, stdout: "pipe", stderr: "pipe" },
  );
  expect(
    preparation.exitCode,
    `${preparation.stdout.toString()}\n${preparation.stderr.toString()}`,
  ).toBe(0);
});

for (const environment of ["production", "staging", undefined]) {
  test(`published legal documents stay visible in ${environment ?? "ordinary"} builds`, async () => {
    const output = await mkdtemp(resolve(tmpdir(), "tearleads-legal-build-"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Publication must not depend on an inherited NODE_ENV.
      NODE_ENV: "test",
      PUBLIC_STRIPE_CUSTOMER_PORTAL_URL:
        "https://billing.stripe.com/p/login/test",
      ASTRO_TELEMETRY_DISABLED: "1",
    };
    if (environment === undefined) delete env.PUBLIC_ENVIRONMENT;
    else env.PUBLIC_ENVIRONMENT = environment;
    const child = Bun.spawn(
      [
        resolve(website, "node_modules/.bin/astro"),
        "build",
        "--outDir",
        output,
      ],
      { cwd: website, env, stdout: "pipe", stderr: "pipe" },
    );
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code, `${stdout}\n${stderr}`).toBe(0);
      const index = await Bun.file(resolve(output, "index.html")).text();
      const scripts = await Promise.all(
        [...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
          .map((match) => match[1])
          .filter(
            (source): source is string =>
              source?.startsWith("/_astro/") === true,
          )
          .map((source) => Bun.file(resolve(output, `.${source}`)).text()),
      );
      // Prove the shared layout emits its CT initializer in actual builds.
      expect(
        scripts.some((script) =>
          script.includes("https://ct.a2f0.net/v1/clicks"),
        ),
      ).toBe(true);
      const channel = environment === "staging" ? "canary" : "stable";
      for (const target of ["macos-arm64", "linux-x64"]) {
        const appName =
          environment === "staging" && target === "macos-arm64"
            ? "(?:TLStaging|Tearleads)"
            : "Tearleads";
        expect(index).toMatch(
          new RegExp(`${channel}-${target}-[a-f0-9]{64}-${appName}`),
        );
      }
      expect(index).toContain('href="/downloads/linux/"');
      const staging = environment === "staging";
      expect(index).toContain(
        staging
          ? 'href="https://testflight.apple.com/join/JGZxEWQD"'
          : 'href="https://apps.apple.com/app/id6793172063"',
      );
      expect(index.includes("https://apps.apple.com/app/")).toBe(!staging);
      expect(index).toContain(
        `href="https://play.google.com/apps/internaltest/${staging ? "4700608793048750781" : "4701368218502321967"}"`,
      );
      // The nav, footer, and other pages link to these anchors.
      expect(index).toContain('id="download"');
      expect(index).toContain('id="security-summary"');
      const security = await Bun.file(
        resolve(output, "security/index.html"),
      ).text();
      for (const anchor of [
        "threat-model",
        "device-boundary",
        "verified-sharing",
        "access-keying",
        "cryptography",
        "infrastructure",
        "local-storage",
        "trust-boundaries",
        "documents",
      ]) {
        expect(security).toContain(`id="${anchor}"`);
      }
      expect(security).not.toContain("<details");
      const features = await Bun.file(
        resolve(output, "features/index.html"),
      ).text();
      expect(features).toContain('id="sync-and-sharing"');
      expect(features).toContain('id="document-authorship"');
      const featureDetails = await Promise.all(
        ["authorship", "sharing"].map((slug) =>
          Bun.file(resolve(output, "features", slug, "index.html")).text(),
        ),
      );
      // Pages that show phone captures, which leave out the in-app test
      // banner, carry the release notice while it is set.
      if (releaseNotice !== null) {
        for (const html of [index, features, ...featureDetails]) {
          expect(html).toContain(releaseNotice);
        }
      }
      expect(
        await Bun.file(resolve(output, "downloads/linux/index.html")).text(),
      ).toContain("./installer");
      for (const [route, contentMarker] of [
        ["privacy-policy", "Limited error diagnostics"],
        ["terms-of-service", "Limits on liability"],
      ]) {
        const html = await Bun.file(
          resolve(output, route, "index.html"),
        ).text();
        expect(html).toContain(`mailto:${legalDetails.email}`);
        expect(html).toContain(legalDetails.operator);
        expect(html).toContain(contentMarker);
        // The related-documents nav marks the page itself as current.
        expect(html).toContain(`<a href="/${route}/" aria-current="page">`);
        if (route === "privacy-policy") {
          for (const disclosure of [
            "Click analytics",
            "Global Privacy Control",
            "90 days",
            "connection IP address",
            "administrator login",
          ])
            expect(html).toContain(disclosure);
          expect(html).not.toContain("does not change its behavior");
        }
        expect(html).not.toContain('aria-label="At a glance"');
        expect(html).toContain('id="contents-title"');
        expect(html).toContain(`datetime="${legalDetails.updatedAt}"`);
        expect(html).toMatch(/>\s*Effective\s*<time/);
        expect(html).not.toContain("being prepared for publication");
        expect(html).not.toContain("Review draft");
        expect(html).not.toContain("Not yet effective");
        expect(html.includes('name="robots" content="noindex, nofollow"')).toBe(
          environment === "staging",
        );
        expect(html.includes('name="robots"')).toBe(environment === "staging");
      }
    } finally {
      if (child.exitCode === null) child.kill();
      await child.exited;
      await rm(output, { recursive: true, force: true });
    }
  }, 30_000);
}

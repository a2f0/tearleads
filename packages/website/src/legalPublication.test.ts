import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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
  test(`legal drafts have the correct visibility in ${environment ?? "ordinary"} builds`, async () => {
    const output = await mkdtemp(resolve(tmpdir(), "tearleads-legal-build-"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // An inherited non-production NODE_ENV must not expose draft build output.
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
      const channel = environment === "staging" ? "canary" : "stable";
      for (const target of ["macos-arm64", "linux-x64"]) {
        expect(index).toMatch(
          new RegExp(`${channel}-${target}-[a-f0-9]{64}-Tearleads`),
        );
      }
      expect(index).toContain('href="/downloads/linux"');
      expect(
        await Bun.file(resolve(output, "downloads/linux/index.html")).text(),
      ).toContain("./installer");
      const showDocument = !legalDetails.isDraft || environment === "staging";
      for (const [route, contentMarker] of [
        ["privacy-policy", "Limited error diagnostics"],
        ["terms-of-service", "Limits on liability"],
      ]) {
        const html = await Bun.file(
          resolve(output, route, "index.html"),
        ).text();
        expect(html).toContain(`mailto:${legalDetails.email}`);
        expect(html).toContain(legalDetails.operator);
        expect(html.includes(contentMarker)).toBe(showDocument);
        expect(html.includes('aria-label="At a glance"')).toBe(showDocument);
        expect(html.includes('id="contents-title"')).toBe(showDocument);
        expect(html.includes("being prepared for publication")).toBe(
          !showDocument,
        );
        expect(html.includes('name="robots" content="noindex"')).toBe(
          legalDetails.isDraft || environment === "staging",
        );
      }
    } finally {
      if (child.exitCode === null) child.kill();
      await child.exited;
      await rm(output, { recursive: true, force: true });
    }
  }, 30_000);
}

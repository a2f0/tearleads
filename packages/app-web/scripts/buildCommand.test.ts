import { expect, test } from "bun:test";
import packageJson from "../package.json";

test("production build resolves React packages in production mode", () => {
  expect(packageJson.scripts.build).toContain("export NODE_ENV=production");
  expect(packageJson.scripts.build).not.toContain(
    "--define:process.env.NODE_ENV",
  );
});

test("production build renders and links brand images before precaching", () => {
  const steps = packageJson.scripts.build.split(" && ");
  const images = steps.indexOf("agent-tool --repo ../.. images build app-web");
  const links = steps.indexOf("bun scripts/injectFaviconLinks.ts");
  const tierTags = steps.indexOf("bun scripts/injectTierMeta.ts");
  const precache = steps.indexOf("bun scripts/buildServiceWorker.ts");
  expect(images).toBeGreaterThan(
    steps.indexOf("bun scripts/buildStaticAssets.ts"),
  );
  expect(links).toBeGreaterThan(0);
  // The precached shell must be the tier's final document.
  expect(tierTags).toBeGreaterThan(0);
  expect(precache).toBeGreaterThan(Math.max(images, links, tierTags));
});

test("app-web deploy builds against the websocket events endpoint", async () => {
  const deployScript = await Bun.file(
    new URL("./deployAppWeb.sh", import.meta.url),
  ).text();
  const apiHostnamePlaceholder = "$" + "{API_HOSTNAME}";

  expect(deployScript).toContain("NODE_ENV=production");
  expect(deployScript).toContain(
    `BUN_PUBLIC_WS_URL="wss://${apiHostnamePlaceholder}/events"`,
  );
});

test("app-web deploy stages the demo variant as its own asset Worker", async () => {
  const deployScript = await Bun.file(
    new URL("./deployAppWeb.sh", import.meta.url),
  ).text();

  expect(deployScript).toContain('build_app_web "demo" "app-demo"');
  expect(deployScript).toContain('stage_assets "demo"');
  expect(deployScript).toContain('publish_assets "demo" "app-demo"');
  // `bun run build` clears dist/, so the app bundle must be staged before
  // the demo build overwrites it.
  expect(deployScript.indexOf('stage_assets "app"')).toBeLessThan(
    deployScript.indexOf('build_app_web "demo" "app-demo"'),
  );
});

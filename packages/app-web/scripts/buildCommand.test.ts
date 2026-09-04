import { expect, test } from "bun:test";
import packageJson from "../package.json";

test("production build emits root-relative app shell asset URLs", () => {
  expect(packageJson.scripts.build).toContain("--public-path=/");
});

test("production build resolves React packages in production mode", () => {
  expect(packageJson.scripts.build).toContain("export NODE_ENV=production");
  expect(packageJson.scripts.build).not.toContain(
    "--define:process.env.NODE_ENV",
  );
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

test("app-web deploy ships the demo variant to its own web root", async () => {
  const deployScript = await Bun.file(
    new URL("./deployAppWeb.sh", import.meta.url),
  ).text();

  expect(deployScript).toContain('build_app_web "demo" "app-demo"');
  expect(deployScript).toContain(
    'deploy_app_web_dist "app-demo" "/var/www/app-demo"',
  );
  // `bun run build` clears dist/, so the app bundle must reach the server
  // before the demo build overwrites it.
  expect(
    deployScript.indexOf('deploy_app_web_dist "app-web" "/var/www/app-web"'),
  ).toBeLessThan(deployScript.indexOf('build_app_web "demo" "app-demo"'));
});

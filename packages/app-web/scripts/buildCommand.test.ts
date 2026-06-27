import { expect, test } from "bun:test";
import packageJson from "../package.json";

test("production build emits root-relative app shell asset URLs", () => {
  expect(packageJson.scripts.build).toContain("--public-path=/");
});

test("app-web deploy builds against the websocket events endpoint", async () => {
  const deployScript = await Bun.file(
    new URL("./deployAppWeb.sh", import.meta.url),
  ).text();
  const domainPlaceholder = "$" + "{DOMAIN}";

  expect(deployScript).toContain(
    `BUN_PUBLIC_WS_URL="wss://api.${domainPlaceholder}/events"`,
  );
});

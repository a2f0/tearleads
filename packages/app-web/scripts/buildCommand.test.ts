import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json";

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

test("app-web deploy retains older versioned PDF assets for open tabs", async () => {
  const deployScript = await Bun.file(
    new URL("./deployAppWeb.sh", import.meta.url),
  ).text();
  expect(deployScript).toContain("--delete");
  expect(deployScript).not.toContain("--delete-excluded");
  expect(deployScript).toContain("--filter='P /pdfjs/***'");
  expect(deployScript).toContain("--filter='-s *.map'");
});

test("PDF deploy filter preserves old workers but removes obsolete source maps", async () => {
  if (!Bun.which("rsync")) return;
  const root = await mkdtemp(join(tmpdir(), "tearleads-pdf-upgrade-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(join(source, "pdfjs", "new"), { recursive: true });
    await mkdir(join(destination, "pdfjs", "old"), { recursive: true });
    await writeFile(join(source, "pdfjs", "new", "pdf.worker.js"), "new");
    await writeFile(join(destination, "pdfjs", "old", "pdf.worker.js"), "old");
    await writeFile(join(source, "new.map"), "not deployed");
    await writeFile(join(destination, "old.map"), "delete");
    execFileSync("rsync", [
      "-a",
      "--delete",
      "--filter=P /pdfjs/***",
      "--filter=-s *.map",
      `${source}/`,
      `${destination}/`,
    ]);
    expect(
      await readFile(
        join(destination, "pdfjs", "old", "pdf.worker.js"),
        "utf8",
      ),
    ).toBe("old");
    expect(
      await readFile(
        join(destination, "pdfjs", "new", "pdf.worker.js"),
        "utf8",
      ),
    ).toBe("new");
    await expect(stat(join(destination, "old.map"))).rejects.toThrow();
    await expect(stat(join(destination, "new.map"))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

export async function verifyMacosDmg(
  root: string,
  dmg: string,
  archivedApp: string,
  env: Record<string, string | undefined>,
) {
  const mount = join(root, "mounted-dmg");
  const home = join(root, "launch-home");
  await mkdir(mount);
  await mkdir(home);
  execFileSync(
    "/usr/bin/hdiutil",
    ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg],
    { stdio: "ignore" },
  );
  try {
    const app = join(mount, basename(archivedApp));
    assert.equal(readlinkSync(join(mount, "Applications")), "/Applications");
    assert.equal(
      existsSync(join(app, "Contents/Resources/metadata.json")),
      false,
    );
    for (const file of [
      "Info.plist",
      "MacOS/launcher",
      "Resources/version.json",
      "Resources/app/bun/index.js",
      "Resources/app/views/mainview/index.html",
      "Resources/app/views/mainview/worker.js",
      "Resources/app/views/mainview/sqlite3.wasm",
    ])
      assert.deepEqual(
        readFileSync(join(app, "Contents", file)),
        readFileSync(join(archivedApp, "Contents", file)),
        `DMG must contain the expanded app: ${file}`,
      );
    assert.deepEqual(
      [...new Bun.Glob("**/*.map").scanSync({ cwd: app })],
      [],
      "Source maps must not enter the DMG",
    );

    // Reach the bundled Bun through the native launcher on a read-only volume.
    // Exit in a test-only preload before opening windows, binding the app port,
    // or contacting services; all installer records go into the isolated home.
    const marker = join(root, "dmg-launched");
    const preload = join(root, "launchProbe.ts");
    await Bun.write(
      preload,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "launched"); process.exit(0);\n`,
    );
    execFileSync(join(app, "Contents/MacOS/launcher"), [], {
      env: {
        ...env,
        HOME: home,
        BUN_OPTIONS: `--preload=${preload}`,
        ELECTROBUN_INSTALLER_UI_AUTOCLOSE: "1",
      },
      timeout: 15_000,
      stdio: "pipe",
    });
    assert.equal(readFileSync(marker, "utf8"), "launched");
    console.log("The expanded DMG app launches from a read-only volume.");
  } finally {
    execFileSync("/usr/bin/hdiutil", ["detach", mount], { stdio: "ignore" });
  }
}

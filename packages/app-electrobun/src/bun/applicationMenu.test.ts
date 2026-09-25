import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise menu installation against the native API boundary, including
// Linux's forwarded role reaching the application's quit lifecycle.
const nativeFixture = `
import assert from "node:assert/strict";
let menu;
let onClick;
let quitCount = 0;
export const ApplicationMenu = {
  on(name, handler) {
    assert.equal(name, "application-menu-clicked");
    onClick = handler;
  },
  setApplicationMenu(value) { menu = value; },
};
export const Utils = { quit() { quitCount++; } };
export function verifyMenu() {
    assert.ok(menu, "Install the menu at startup");
    const file = menu.find(item => item.label === "File");
    assert.ok(file, "File must be visible on every desktop platform");
    const quit = file.submenu.find(item => item.role === "quit");
    assert.equal(quit?.accelerator, "CommandOrControl+Q");
    if (process.platform === "darwin") {
      assert.equal(menu[0].label, "TL Staging");
      assert.notEqual(menu[0], file, "AppKit reserves the first menu for the app");
      const edit = menu.find(item => item.label === "Edit");
      assert.ok(edit.submenu.some(item => item.role === "copy"));
      assert.ok(edit.submenu.some(item => item.role === "paste"));
    } else {
      assert.equal(menu[0], file);
      assert.ok(!menu.some(item => item.label === "Edit"));
    }
    assert.equal(typeof onClick, "function");
    for (const event of [null, undefined, "quit", {}, { data: null },
      { data: "quit" }, { data: {} }, { data: { action: "copy" } }]) {
      onClick(event);
    }
    assert.equal(quitCount, 0);
    // Electrobun's Linux wrapper forwards role-only items with role as action.
    onClick({ data: { id: 0, action: quit.role } });
    assert.equal(quitCount, 1);
    console.log("MENU_QUIT_OK");
}
`;

for (const platform of ["darwin", "linux", "win32"]) {
  test(`main-process menu startup and forwarded quit on ${platform}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "electrobun-menu-"));
    try {
      const entry = join(directory, "entry.ts");
      await Bun.write(
        entry,
        `
import { installApplicationMenu } from ${JSON.stringify(join(import.meta.dirname, "applicationMenu.ts"))};
import { verifyMenu } from "electrobun/bun";
installApplicationMenu("TL Staging");
verifyMenu();
`,
      );
      const result = await Bun.build({
        entrypoints: [entry],
        outdir: directory,
        target: "bun",
        define: {
          "process.platform": JSON.stringify(platform),
        },
        plugins: [
          {
            name: "desktop-native-fixture",
            setup(build) {
              build.onResolve({ filter: /^electrobun\/bun$/u }, (args) => ({
                path: args.path,
                namespace: "desktop-native-fixture",
              }));
              build.onLoad(
                { filter: /.*/u, namespace: "desktop-native-fixture" },
                () => ({
                  contents: nativeFixture,
                  loader: "js",
                }),
              );
            },
          },
        ],
      });
      expect(result.success).toBe(true);
      const run = Bun.spawn([process.execPath, join(directory, "entry.js")], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
        run.exited,
      ]);
      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toContain("MENU_QUIT_OK");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

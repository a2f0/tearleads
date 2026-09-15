import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const hook = join(import.meta.dirname, "postWrap.ts");
const path = `${dirname(process.execPath)}:/usr/bin:/bin`;

for (const name of ["Tearleads", "Tearleads-canary"]) {
  for (const valid of [true, false]) {
    test(`${name} ${valid ? "restores its expanded app" : "rejects a mismatched payload without deleting its wrapper"}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "macos-post-wrap-"));
      try {
        const build = join(root, "build");
        const wrapper = join(build, `${name}.app`);
        const resources = join(wrapper, "Contents/Resources");
        const contents = `${name}.app/Contents`;
        const input = join(root, "input");
        await mkdir(resources, { recursive: true });
        const metadata = JSON.stringify({ hash: "abc123" });
        await Bun.write(join(resources, "metadata.json"), metadata);
        await Bun.write(
          join(input, contents, "Resources/version.json"),
          JSON.stringify({ hash: valid ? "abc123" : "different" }),
        );
        await Bun.write(join(input, contents, "MacOS/launcher"), "runtime");
        await Bun.write(
          join(input, contents, "Resources/AppIcon.icns"),
          "icon",
        );
        const tar = join(root, "app.tar");
        execFileSync("tar", ["-cf", tar, "-C", input, `${name}.app`]);
        await Bun.write(
          join(resources, "abc123.tar.zst"),
          Bun.zstdCompressSync(readFileSync(tar)),
        );
        const child = Bun.spawn([process.execPath, hook], {
          env: {
            PATH: path,
            ELECTROBUN_OS: "macos",
            ELECTROBUN_BUILD_DIR: build,
            ELECTROBUN_WRAPPER_BUNDLE_PATH: wrapper,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [code, stderr] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
        ]);
        if (valid) {
          expect(code, stderr).toBe(0);
          expect(
            await Bun.file(join(wrapper, "Contents/MacOS/launcher")).text(),
          ).toBe("runtime");
          expect(await Bun.file(join(resources, "AppIcon.icns")).text()).toBe(
            "icon",
          );
          expect(existsSync(join(resources, "metadata.json"))).toBe(false);
          expect(existsSync(join(resources, "abc123.tar.zst"))).toBe(false);
        } else {
          expect(code).not.toBe(0);
          expect(stderr).toContain("macOS DMG payload does not match");
          expect(await Bun.file(join(resources, "metadata.json")).text()).toBe(
            metadata,
          );
          expect(existsSync(join(resources, "abc123.tar.zst"))).toBe(true);
        }
        expect(await readdir(build)).toEqual([`${name}.app`]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}

for (const invalid of ["wrapper", "buildDir", "outside", "extension", "hash"]) {
  test(`rejects invalid ${invalid} before changing the wrapper`, async () => {
    const root = await mkdtemp(join(tmpdir(), "macos-wrapper-guard-"));
    try {
      const build = join(root, "build");
      const wrapper = join(
        invalid === "outside" ? root : build,
        invalid === "extension" ? "Tearleads" : "Tearleads.app",
      );
      const metadata = join(wrapper, "Contents/Resources/metadata.json");
      const contents = JSON.stringify({
        hash: invalid === "hash" ? "../x" : "abc123",
      });
      await Bun.write(metadata, contents);
      const child = Bun.spawn([process.execPath, hook], {
        env: {
          PATH: path,
          ELECTROBUN_OS: "macos",
          ...(invalid === "buildDir" ? {} : { ELECTROBUN_BUILD_DIR: build }),
          ...(invalid === "wrapper"
            ? {}
            : { ELECTROBUN_WRAPPER_BUNDLE_PATH: wrapper }),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(code).not.toBe(0);
      expect(stderr).toContain(
        invalid === "hash"
          ? "Invalid macOS wrapper build hash"
          : "Electrobun did not provide its macOS wrapper bundle",
      );
      expect(await Bun.file(metadata).text()).toBe(contents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("other platforms do not need a macOS wrapper", async () => {
  const child = Bun.spawn([process.execPath, hook], {
    env: { ELECTROBUN_OS: "linux" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(0);
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// The macOS self-extractor replaces its own bundle, which fails on a mounted,
// read-only DMG. Restore the expanded app before Hutch signs and packages it.
// The separate compressed update archive remains owned by Hutch.
const {
  ELECTROBUN_OS: os,
  ELECTROBUN_WRAPPER_BUNDLE_PATH: wrapper,
  ELECTROBUN_BUILD_DIR: buildDir,
} = process.env;
if (os === "macos") {
  if (
    !wrapper ||
    !buildDir ||
    dirname(resolve(wrapper)) !== resolve(buildDir) ||
    !wrapper.endsWith(".app")
  )
    throw new Error("Electrobun did not provide its macOS wrapper bundle");

  const resources = join(wrapper, "Contents/Resources");
  const { hash }: { hash?: unknown } = JSON.parse(
    readFileSync(join(resources, "metadata.json"), "utf8"),
  );
  if (typeof hash !== "string" || !/^[a-z0-9]+$/iu.test(hash))
    throw new Error("Invalid macOS wrapper build hash");

  const staging = mkdtempSync(join(buildDir, ".macos-dmg-"));
  let removeStaging = true;
  try {
    execFileSync("/usr/bin/tar", ["-xf", "-", "-C", staging], {
      input: Bun.zstdDecompressSync(
        readFileSync(join(resources, `${hash}.tar.zst`)),
      ),
      stdio: ["pipe", "inherit", "inherit"],
    });
    const app = join(staging, basename(wrapper));
    const version: { hash?: unknown } = JSON.parse(
      readFileSync(join(app, "Contents/Resources/version.json"), "utf8"),
    );
    if (version.hash !== hash)
      throw new Error("macOS DMG payload does not match its wrapper");
    const previous = join(staging, ".wrapper");
    renameSync(wrapper, previous);
    try {
      renameSync(app, wrapper);
    } catch (error) {
      // Retain the backup if even the rollback fails; a failed hook cannot
      // proceed to signing or publish an incomplete app.
      removeStaging = false;
      renameSync(previous, wrapper);
      removeStaging = true;
      throw error;
    }
  } finally {
    if (removeStaging) rmSync(staging, { recursive: true, force: true });
  }
}

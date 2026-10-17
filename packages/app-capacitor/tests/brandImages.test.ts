import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

// The native images are rendered by agent-tool from the capacitor-* targets in
// the repository's agent-tool.json and are gitignored. These tests keep the
// committed native resources and that configuration consistent.
const packageRoot = resolve(import.meta.dir, "..");
const repoRoot = resolve(packageRoot, "../..");
const resDir = join(packageRoot, "android/app/src/main/res");
const assetCatalog = join(packageRoot, "ios/App/App/Assets.xcassets");
const androidDensities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];

interface ImageTarget {
  name: string;
  dir: string;
  files: string[];
}

async function listImageTarget(name: string): Promise<ImageTarget> {
  const child = Bun.spawn(
    [
      process.execPath,
      join(repoRoot, "node_modules/.bin/agent-tool"),
      "--repo",
      repoRoot,
      "images",
      "list",
      name,
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`agent-tool images list ${name} failed: ${stderr}`);
  }
  const { targets } = JSON.parse(stdout) as { targets: ImageTarget[] };
  const target = targets.find((entry) => entry.name === name);
  if (target === undefined) throw new Error(`No ${name} image target`);
  return target;
}

async function committedAndroidXml(): Promise<string[]> {
  const paths: string[] = [];
  for (const folder of await readdir(resDir)) {
    if (!/^(drawable|mipmap)(-|$)/.test(folder)) continue;
    for (const file of await readdir(join(resDir, folder))) {
      if (file.endsWith(".xml")) paths.push(`${folder}/${file}`);
    }
  }
  return paths;
}

test("Android resource references resolve to committed or rendered images", async () => {
  const target = await listImageTarget("capacitor-android");
  expect(join(repoRoot, target.dir)).toBe(resDir);
  const committed = await committedAndroidXml();
  const sources = [
    join(packageRoot, "android/app/src/main/AndroidManifest.xml"),
    join(resDir, "values/styles.xml"),
    ...committed.map((path) => join(resDir, path)),
  ];
  const references = new Set<string>();
  for (const source of sources) {
    const xml = await Bun.file(source).text();
    for (const [, type, name] of xml.matchAll(
      /@(drawable|mipmap)\/([a-z0-9_]+)/g,
    )) {
      references.add(`${type}/${name}`);
    }
  }
  expect([...references]).toContain("mipmap/ic_launcher_foreground");
  for (const reference of references) {
    const [type, name] = reference.split("/");
    const isCommitted = committed.some(
      (path) =>
        path.startsWith(type ?? "") && path.endsWith(`/${name ?? ""}.xml`),
    );
    if (isCommitted) continue;
    for (const density of androidDensities) {
      expect(target.files).toContain(`${type}-${density}/${name}.png`);
    }
  }
});

test("rendered Android images never duplicate a committed resource", async () => {
  const target = await listImageTarget("capacitor-android");
  const committed = await committedAndroidXml();
  for (const file of target.files) {
    expect(committed).not.toContain(file.replace(/\.png$/, ".xml"));
  }
});

test("iOS asset catalogs name exactly the rendered images", async () => {
  const target = await listImageTarget("capacitor-ios");
  expect(join(repoRoot, target.dir)).toBe(assetCatalog);
  const named: string[] = [];
  for (const set of ["AppIcon.appiconset", "Splash.imageset"]) {
    const contents = (await Bun.file(
      join(assetCatalog, set, "Contents.json"),
    ).json()) as { images: { filename?: string }[] };
    for (const { filename } of contents.images) {
      if (filename !== undefined) named.push(`${set}/${filename}`);
    }
  }
  expect(named.toSorted()).toEqual(target.files.toSorted());
});

import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { packagePreloads, testFileArgument } from "./testProcess";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function packageWith(bunfig?: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "test-process-"));
  directories.push(root);
  if (bunfig !== undefined)
    await writeFile(resolve(root, "bunfig.toml"), bunfig);
  return root;
}

test("reads a package's test preloads in either bunfig form", async () => {
  expect(
    await packagePreloads(
      await packageWith('[test]\npreload = ["./a.ts", "./b.ts"]\n'),
    ),
  ).toEqual(["./a.ts", "./b.ts"]);
  expect(
    await packagePreloads(await packageWith('[test]\npreload = "./a.ts"\n')),
  ).toEqual(["./a.ts"]);
  expect(await packagePreloads(await packageWith("[install]\n"))).toEqual([]);
  expect(await packagePreloads(await packageWith())).toEqual([]);
  await expect(
    packagePreloads(await packageWith("[test]\npreload = [1]\n")),
  ).rejects.toThrow(/preload/);
});

test("a bunfig.toml that cannot be read stops the run", async () => {
  const root = await packageWith();
  await mkdir(resolve(root, "bunfig.toml"));
  await expect(packagePreloads(root)).rejects.toThrow(/EISDIR/);
});

test("the repository's own packages name their preloads", async () => {
  const packages = resolve(import.meta.dir, "../..");
  expect(await packagePreloads(resolve(packages, "api"))).toEqual([
    "./test/preload.ts",
  ]);
  expect(await packagePreloads(resolve(packages, "app"))).toEqual([
    "./happydom.ts",
  ]);
});

test("makes a test file a path so Bun does not read it as a filter", () => {
  expect(testFileArgument("src/a.test.ts")).toBe("./src/a.test.ts");
  expect(testFileArgument("./src/a.test.ts")).toBe("./src/a.test.ts");
  expect(testFileArgument("/abs/a.test.ts")).toBe("/abs/a.test.ts");
});

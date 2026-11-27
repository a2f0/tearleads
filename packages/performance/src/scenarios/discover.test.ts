import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { discoverScenarios, selectScenarios } from "./discover";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

test("discovers scenario test files in lexical order and skips helpers", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "scenarios-discover-"));
  directories.push(root);
  const dir = resolve(root, "src/scenarios");
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "rotationHistory.test.ts"), "");
  await writeFile(resolve(dir, "baselineGroup.testUtils.ts"), "");
  await writeFile(resolve(dir, "adminsGroupRevoke.test.ts"), "");

  expect(await discoverScenarios(root)).toEqual([
    {
      name: "adminsGroupRevoke",
      file: "src/scenarios/adminsGroupRevoke.test.ts",
    },
    {
      name: "rotationHistory",
      file: "src/scenarios/rotationHistory.test.ts",
    },
  ]);
});

test("selectScenarios filters case-insensitively and rejects unmatched filters", () => {
  const rotations = {
    name: "manyRotations",
    file: "src/scenarios/manyRotations.test.ts",
  };
  const list = [
    rotations,
    { name: "stagedBaseline", file: "src/scenarios/stagedBaseline.test.ts" },
  ];
  expect(selectScenarios(list, [])).toEqual(list);
  expect(selectScenarios(list, ["ROTATION"])).toEqual([rotations]);
  expect(() => selectScenarios(list, ["missing"])).toThrow(
    /No scenario matches "missing"/u,
  );
});

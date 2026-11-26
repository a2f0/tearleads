import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  loadSeededTree,
  type SeededTree,
  saveJson,
  seedFileName,
} from "./artifacts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function scratch() {
  const directory = await mkdtemp(resolve(tmpdir(), "realtime-artifacts-"));
  directories.push(directory);
  return resolve(directory, "reports");
}

const seed: SeededTree = {
  schemaVersion: 1,
  database: "scratch/db",
  userId: "user",
  fanout: 10,
  containerIds: ["a", "b"],
  seededAt: "2026-11-25T00:00:00.000Z",
  seedMs: 5,
};

test("saves owner-only reports and reloads the seeded tree", async () => {
  const directory = await scratch();
  expect(seedFileName("scratch/db")).toBe("realtime-seed-scratch_db.json");
  const path = await saveJson(seedFileName(seed.database), seed, directory);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  expect(await loadSeededTree(seed.database, directory)).toEqual(seed);
});

test("refuses a missing, foreign, or malformed seed", async () => {
  const directory = await scratch();
  await expect(loadSeededTree("absent", directory)).rejects.toThrow(
    /run without --reuse/,
  );
  await saveJson(seedFileName("other"), seed, directory);
  await expect(loadSeededTree("other", directory)).rejects.toThrow(
    /not a seeded tree/,
  );
  await writeFile(resolve(directory, seedFileName("broken")), "{}");
  await expect(loadSeededTree("broken", directory)).rejects.toThrow(
    /not a seeded tree/,
  );
});

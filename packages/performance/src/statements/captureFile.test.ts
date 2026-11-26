import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readCaptureFile } from "./captureFile";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), "capture-file-"));
  directories.push(path);
  return path;
}

test("a written capture is read whole", async () => {
  const path = resolve(await directory(), "capture.jsonl");
  await writeFile(path, '{"phaseEnd":"a","requests":1}\n');
  expect(await readCaptureFile(path)).toBe('{"phaseEnd":"a","requests":1}\n');
});

test("a capture that was never written reads as null", async () => {
  expect(
    await readCaptureFile(resolve(await directory(), "none.jsonl")),
  ).toBeNull();
});

test("any other read error is thrown", async () => {
  await expect(readCaptureFile(await directory())).rejects.toThrow();
});

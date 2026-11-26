import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Where the root `perf:*` scripts are run from. */
export const repositoryRoot = resolve(import.meta.dir, "../../..");

/** `.test_files/performance` at the repository root: ignored and private. */
export const reportDirectory = resolve(
  repositoryRoot,
  ".test_files/performance",
);

/** Creates `directory` owner-only, or makes an existing one owner-only. */
export async function privateDirectory(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

/** Writes `contents` as an owner-only file, replacing it atomically. */
export async function saveReportFile(
  name: string,
  contents: string,
  directory = reportDirectory,
): Promise<string> {
  const path = resolve(await privateDirectory(directory), name);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

/** Writes `value` as owner-only JSON, replacing the file atomically. */
export function saveJson(
  name: string,
  value: object,
  directory = reportDirectory,
): Promise<string> {
  return saveReportFile(name, `${JSON.stringify(value, null, 2)}\n`, directory);
}

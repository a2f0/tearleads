import { execFileSync } from "node:child_process";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export function sourceIdentity() {
  const root = resolve(import.meta.dir, "../../../..");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  return {
    revision: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain").length > 0,
  };
}

export async function databaseReport(
  environment: string,
  runId: string,
  directory = resolve(import.meta.dir, "../../../../.test_files/performance"),
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = resolve(directory, `database-${environment}-${runId}.json`);
  return {
    path,
    async save(report: object) {
      const temporary = `${path}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}

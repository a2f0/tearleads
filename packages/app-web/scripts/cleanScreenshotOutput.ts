import { readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SCREENSHOTS_DIR = path.join(REPO_ROOT, ".screenshots");
const CANONICAL_PROJECTS = ["web", "mobile", "ipad"] as const;

async function removeDirectFiles(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    },
  );
  await Promise.all(
    entries
      .filter((entry) => !entry.isDirectory())
      .map((entry) => rm(path.join(directory, entry.name), { force: true })),
  );
}

export async function cleanScreenshotOutput(
  outputDirectory = SCREENSHOTS_DIR,
): Promise<void> {
  // Remove the retired standalone collection and pre-theme files such as
  // `.screenshots/web/org-manager.png`. Preserve canonical theme directories:
  // standard and blame projects may run as separate jobs and must compose into
  // one gallery instead of deleting each other's artifacts.
  await rm(path.join(outputDirectory, "collaboration"), {
    force: true,
    recursive: true,
  });
  await Promise.all(
    CANONICAL_PROJECTS.map((project) =>
      removeDirectFiles(path.join(outputDirectory, project)),
    ),
  );
}

if (import.meta.main) {
  await cleanScreenshotOutput();
  console.log("Removed stale legacy screenshot output.");
}

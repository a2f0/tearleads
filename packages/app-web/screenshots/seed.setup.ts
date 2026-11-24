import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { seedIdentity } from "./continuity";

// Each capture project depends on one of these setup projects, which seeds the
// fixture account on that project's fresh in-memory API exactly as a person
// seeds their own: the `tearleads` CLI registers the Continuity identity, syncs
// the pinned dataset into it, and, with `--roster`, gives each group member an
// account on the roster and in the group. The capture then signs a new browser
// in as that identity, like a second device, and the app downloads what was
// seeded.
const CLI = fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url));

// The CLI's own deadline is far longer; a seed of the local API takes about a
// minute.
const COMMAND_TIMEOUT_MS = 5 * 60_000;

/** Runs one CLI command with the recovery key on stdin; rejects on failure. */
function tearleads(args: readonly string[], recoveryKey: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("bun", [CLI, ...args, "--key-stdin"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: COMMAND_TIMEOUT_MS,
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `tearleads ${args.join(" ")} failed (${signal ?? code}):\n${output}`,
          ),
        );
    });
    child.stdin.end(`${recoveryKey}\n`);
  });
}

test("seed the capture account through the CLI", async () => {
  test.setTimeout(2 * COMMAND_TIMEOUT_MS);
  const apiUrl: unknown = Reflect.get(
    test.info().project.metadata,
    "screenshotApiBaseUrl",
  );
  if (typeof apiUrl !== "string") {
    throw new Error(`Missing API URL for ${test.info().project.name}.`);
  }
  for (const command of [["register"], ["seed", "--roster"]]) {
    await tearleads(
      [...command, "--api-url", apiUrl],
      seedIdentity.identitySeedPhrase,
    );
  }
});

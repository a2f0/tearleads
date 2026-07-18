import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { cleanScreenshotOutput } from "./cleanScreenshotOutput";

test("cleanScreenshotOutput removes legacy captures and preserves themed jobs", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "tearleads-screenshots-"),
  );
  try {
    await mkdir(path.join(fixtureRoot, "web", "light"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "collaboration", "dark"), {
      recursive: true,
    });
    await writeFile(path.join(fixtureRoot, "web", "org-manager.png"), "stale");
    await writeFile(
      path.join(fixtureRoot, "web", "light", "org-manager.png"),
      "current",
    );
    await writeFile(
      path.join(fixtureRoot, "collaboration", "dark", "note-blame.png"),
      "stale",
    );

    await cleanScreenshotOutput(fixtureRoot);

    await expect(
      stat(path.join(fixtureRoot, "web", "org-manager.png")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(path.join(fixtureRoot, "collaboration")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(path.join(fixtureRoot, "web", "light", "org-manager.png")),
    ).resolves.toBeDefined();
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

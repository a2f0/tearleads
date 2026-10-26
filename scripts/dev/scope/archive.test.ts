import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "tar";
import { createCodebaseArchive } from "./archive";
import { gitAt } from "./git";

function git(cwd: string, ...args: string[]): string {
  return gitAt(cwd, "-c", "commit.gpgsign=false", ...args);
}

test("snapshot preserves a divergent Git base without host configuration or dirty files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scope-archive-test-"));
  const source = join(directory, "source");
  const restored = join(directory, "restored");
  const archive = join(directory, "snapshot.tar.gz");
  try {
    await mkdir(source);
    await mkdir(restored);
    git(source, "-c", "init.templateDir=", "init", "-b", "main");
    git(source, "config", "user.name", "Scope fixture");
    git(source, "config", "user.email", "scope@example.invalid");
    await writeFile(join(source, "tracked.txt"), "original\n");
    await writeFile(join(source, ".gitignore"), "ignored.txt\n");
    git(source, "add", ".");
    git(source, "commit", "-m", "common ancestor");
    const common = git(source, "rev-parse", "HEAD");
    git(source, "checkout", "-b", "feature");
    await writeFile(join(source, "tracked.txt"), "committed feature\n");
    git(source, "commit", "-am", "feature");
    const commit = git(source, "rev-parse", "HEAD");
    git(source, "checkout", "main");
    await writeFile(join(source, "base.txt"), "new base\n");
    git(source, "add", ".");
    git(source, "commit", "-m", "base advanced");
    const baseCommit = git(source, "rev-parse", "HEAD");
    git(source, "checkout", "feature");
    git(
      source,
      "config",
      "remote.origin.url",
      "https://sentinel.invalid/private",
    );
    git(source, "config", "credential.helper", "scope-fixture-sentinel");
    await mkdir(join(source, ".git/hooks"));
    await writeFile(
      join(source, ".git/hooks/post-checkout"),
      "host hook sentinel",
    );
    await writeFile(join(source, "tracked.txt"), "dirty edit\n");
    await writeFile(join(source, "untracked.txt"), "untracked sentinel");
    await writeFile(join(source, "ignored.txt"), "ignored sentinel");

    assert.deepEqual(
      await createCodebaseArchive(source, archive, "feature", "main"),
      {
        commit,
        baseCommit,
      },
    );
    await extract({ file: archive, cwd: restored });
    assert.equal(git(restored, "rev-parse", "HEAD"), commit);
    assert.equal(git(restored, "rev-parse", "origin/main"), baseCommit);
    assert.equal(git(restored, "merge-base", "HEAD", "origin/main"), common);
    assert.equal(git(restored, "status", "--porcelain"), "");
    assert.equal(git(restored, "remote", "-v"), "");
    assert.equal(git(restored, "show", "origin/main:base.txt"), "new base");
    assert.equal(
      await readFile(join(restored, "tracked.txt"), "utf8"),
      "committed feature\n",
    );
    assert.doesNotMatch(
      await readFile(join(restored, ".git/config"), "utf8"),
      /sentinel|credential/,
    );
    for (const file of [
      "untracked.txt",
      "ignored.txt",
      ".git/hooks/post-checkout",
      ".git/objects/info/alternates",
    ])
      assert.equal(await Bun.file(join(restored, file)).exists(), false, file);
    // A snapshot can itself be registered: its shallow history still has the pinned base.
    await createCodebaseArchive(restored, archive, "HEAD", "origin/main");
    await assert.rejects(
      createCodebaseArchive(source, archive, "HEAD", "missing-base"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

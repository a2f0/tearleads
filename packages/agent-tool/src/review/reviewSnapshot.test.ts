import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { withReviewSnapshot } from "./reviewSnapshot";

const repositories: string[] = [];

const platformFilesystemAlias =
  process.platform === "darwin"
    ? ["strasse.txt", "stra\u00dfe.txt"]
    : process.platform === "win32"
      ? ["trailing-dot.txt", "trailing-dot.txt."]
      : undefined;

function aliasesOnTemporaryFilesystem(paths: string[] | undefined): boolean {
  if (paths === undefined) {
    return false;
  }
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-tool-alias-probe-"));
  try {
    closeSync(openSync(path.join(rootDir, paths[0] ?? ""), "wx"));
    try {
      closeSync(openSync(path.join(rootDir, paths[1] ?? ""), "wx"));
      return false;
    } catch {
      return true;
    }
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

const hasPlatformFilesystemAlias = aliasesOnTemporaryFilesystem(
  platformFilesystemAlias,
);

function git(rootDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitTreeWithPaths(rootDir: string, paths: string[]): string {
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: rootDir,
    encoding: "utf8",
    input: "hostile\n",
  }).trim();
  const tree = execFileSync("git", ["mktree", "-z"], {
    cwd: rootDir,
    encoding: "utf8",
    input: Buffer.from(
      paths.map((entry) => `100644 blob ${blob}\t${entry}\0`).join(""),
    ),
  }).trim();
  return execFileSync("git", ["commit-tree", tree, "-m", "hostile tree"], {
    cwd: rootDir,
    encoding: "utf8",
  }).trim();
}

function createRepository(): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-tool-source-"));
  repositories.push(rootDir);
  git(rootDir, ["init", "--quiet"]);
  git(rootDir, ["config", "user.email", "agent-tool@example.com"]);
  git(rootDir, ["config", "user.name", "Agent Tool"]);
  mkdirSync(path.join(rootDir, "src"));
  writeFileSync(path.join(rootDir, "src", "tracked.txt"), "committed\n");
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "--quiet", "-m", "test: seed repository"]);
  return rootDir;
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe("withReviewSnapshot", () => {
  test("exports only the immutable tracked HEAD", () => {
    const rootDir = createRepository();
    const head = git(rootDir, ["rev-parse", "HEAD"]);
    writeFileSync(path.join(rootDir, "src", "tracked.txt"), "working tree\n");
    writeFileSync(path.join(rootDir, "untracked-secret.txt"), "secret\n");

    let snapshotRoot = "";
    withReviewSnapshot(rootDir, head, (repositoryRoot) => {
      snapshotRoot = repositoryRoot;
      const trackedPath = path.join(repositoryRoot, "src", "tracked.txt");

      expect(readFileSync(trackedPath, "utf8")).toBe("committed\n");
      expect(
        existsSync(path.join(repositoryRoot, "untracked-secret.txt")),
      ).toBe(false);
      expect(existsSync(path.join(repositoryRoot, ".git"))).toBe(false);
      expect(statSync(trackedPath).mode & 0o222).toBe(0);
      expect(statSync(repositoryRoot).mode & 0o222).toBe(0);
    });

    expect(existsSync(snapshotRoot)).toBe(false);
  });

  test("removes the snapshot when the review throws", () => {
    const rootDir = createRepository();
    const head = git(rootDir, ["rev-parse", "HEAD"]);
    let snapshotRoot = "";

    expect(() =>
      withReviewSnapshot(rootDir, head, (repositoryRoot) => {
        snapshotRoot = repositoryRoot;
        throw new Error("review failed");
      }),
    ).toThrow("review failed");
    expect(existsSync(snapshotRoot)).toBe(false);
  });

  test("ignores branch-controlled export attributes and content filters", () => {
    const rootDir = createRepository();
    writeFileSync(
      path.join(rootDir, ".gitattributes"),
      [
        "hidden.txt export-ignore",
        "subst.txt export-subst",
        "filtered.txt filter=review-snapshot-test",
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(rootDir, "hidden.txt"), "still visible\n");
    writeFileSync(path.join(rootDir, "subst.txt"), "$Format:%H$\n");
    writeFileSync(path.join(rootDir, "filtered.txt"), "raw\n");
    git(rootDir, [
      "config",
      "filter.review-snapshot-test.smudge",
      "sed s/raw/smudged/",
    ]);
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "--quiet", "-m", "test: add hostile attributes"]);
    const head = git(rootDir, ["rev-parse", "HEAD"]);

    withReviewSnapshot(rootDir, head, (repositoryRoot) => {
      expect(
        readFileSync(path.join(repositoryRoot, "hidden.txt"), "utf8"),
      ).toBe("still visible\n");
      expect(readFileSync(path.join(repositoryRoot, "subst.txt"), "utf8")).toBe(
        "$Format:%H$\n",
      );
      expect(
        readFileSync(path.join(repositoryRoot, "filtered.txt"), "utf8"),
      ).toBe("raw\n");
    });
  });

  test("reads the committed blobs rather than local replacement refs", () => {
    const rootDir = createRepository();
    const originalBlob = execFileSync(
      "git",
      ["rev-parse", "HEAD:src/tracked.txt"],
      { cwd: rootDir, encoding: "utf8" },
    ).trim();
    const replacementBlob = execFileSync(
      "git",
      ["hash-object", "-w", "--stdin"],
      {
        cwd: rootDir,
        encoding: "utf8",
        input: "locally replaced\n",
      },
    ).trim();
    git(rootDir, ["replace", originalBlob, replacementBlob]);
    const head = git(rootDir, ["rev-parse", "HEAD"]);

    withReviewSnapshot(rootDir, head, (repositoryRoot) => {
      expect(
        readFileSync(path.join(repositoryRoot, "src", "tracked.txt"), "utf8"),
      ).toBe("committed\n");
    });
  });

  test("materializes the pinned commit when HEAD advances", () => {
    const rootDir = createRepository();
    const pinnedHead = git(rootDir, ["rev-parse", "HEAD"]);
    writeFileSync(path.join(rootDir, "src", "tracked.txt"), "later commit\n");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "--quiet", "-m", "test: advance head"]);

    withReviewSnapshot(rootDir, pinnedHead, (repositoryRoot) => {
      expect(
        readFileSync(path.join(repositoryRoot, "src", "tracked.txt"), "utf8"),
      ).toBe("committed\n");
    });
  });

  test("rejects backslash paths before materializing the tree", () => {
    const rootDir = createRepository();
    const hostileCommit = commitTreeWithPaths(rootDir, ["..\\..\\target"]);

    expect(() =>
      withReviewSnapshot(rootDir, hostileCommit, () => undefined),
    ).toThrow("Unsafe path in reviewed Git tree");
  });

  test("rejects case and Unicode destination collisions", () => {
    const rootDir = createRepository();
    const collisions = [
      ["Case.txt", "case.txt"],
      ["caf\u00e9.txt", "cafe\u0301.txt"],
    ];

    for (const paths of collisions) {
      const hostileCommit = commitTreeWithPaths(rootDir, paths);
      expect(() =>
        withReviewSnapshot(rootDir, hostileCommit, () => undefined),
      ).toThrow("Colliding paths in reviewed Git tree");
    }
  });

  test.skipIf(!hasPlatformFilesystemAlias)(
    "rejects aliases defined by the destination filesystem",
    () => {
      const rootDir = createRepository();
      const paths = platformFilesystemAlias ?? [];
      expect(paths[0]?.normalize("NFC").toLowerCase()).not.toBe(
        paths[1]?.normalize("NFC").toLowerCase(),
      );
      const hostileCommit = commitTreeWithPaths(rootDir, paths);

      expect(() =>
        withReviewSnapshot(rootDir, hostileCommit, () => undefined),
      ).toThrow("Colliding paths in reviewed Git tree");
    },
  );

  test("materializes symlinks whose targets stay inside the snapshot", () => {
    const rootDir = createRepository();
    symlinkSync("src/tracked.txt", path.join(rootDir, "tracked-link"));
    symlinkSync("tracked-link", path.join(rootDir, "tracked-chain"));
    git(rootDir, ["add", "tracked-link", "tracked-chain"]);
    git(rootDir, ["commit", "--quiet", "-m", "test: add safe symlink"]);
    const head = git(rootDir, ["rev-parse", "HEAD"]);

    withReviewSnapshot(rootDir, head, (repositoryRoot) => {
      expect(
        readFileSync(path.join(repositoryRoot, "tracked-link"), "utf8"),
      ).toBe("committed\n");
      expect(
        readFileSync(path.join(repositoryRoot, "tracked-chain"), "utf8"),
      ).toBe("committed\n");
    });
  });

  test("rejects absolute and escaping symlink targets", () => {
    const hostileTargets = ["/etc/passwd", "../../outside-snapshot"];

    for (const target of hostileTargets) {
      const rootDir = createRepository();
      symlinkSync(target, path.join(rootDir, "hostile-link"));
      git(rootDir, ["add", "hostile-link"]);
      git(rootDir, ["commit", "--quiet", "-m", "test: add hostile symlink"]);
      const head = git(rootDir, ["rev-parse", "HEAD"]);

      expect(() => withReviewSnapshot(rootDir, head, () => undefined)).toThrow(
        "Unsafe symlink target",
      );
    }
  });

  test("rejects a chained symlink that resolves outside the snapshot", () => {
    const rootDir = createRepository();
    mkdirSync(path.join(rootDir, "nested"));
    symlinkSync("..", path.join(rootDir, "nested", "inflate"));
    symlinkSync(
      "inflate/../outside-snapshot",
      path.join(rootDir, "nested", "hostile-link"),
    );
    git(rootDir, ["add", "nested"]);
    git(rootDir, ["commit", "--quiet", "-m", "test: add symlink chain"]);
    const head = git(rootDir, ["rev-parse", "HEAD"]);

    expect(() => withReviewSnapshot(rootDir, head, () => undefined)).toThrow(
      "Unsafe symlink target",
    );
  });
});

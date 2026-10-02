import { describe, expect, test } from "bun:test";
import { bumpVersions, checkVersions } from "./bumpVersions";
import { resolveVersionConflicts } from "./resolveVersionConflicts";
import {
  commitAll,
  commitOnMain,
  FRONTEND,
  git,
  mainOid,
  manifest,
  mergeMain,
  read,
  repository,
  write,
} from "./version.testUtils";

describe("resolveVersionConflicts", () => {
  /** The branch bumped once; main then moved two versions and a dependency. */
  function conflictedMerge(
    extraMainFiles: Record<string, string> = {},
  ): string {
    const rootDir = repository();
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    write(rootDir, FRONTEND, manifest("frontend", "0.7.102"));
    commitAll(rootDir, "feat: change frontend");
    commitOnMain(rootDir, {
      [FRONTEND]: manifest("frontend", "0.7.103", '\n  "license": "MIT",'),
      ...extraMainFiles,
    });
    expect(mergeMain(rootDir)).not.toBe(0);
    return rootDir;
  }

  test("takes the base version and keeps both sides' other edits", () => {
    const rootDir = conflictedMerge();

    expect(resolveVersionConflicts(rootDir)).toBe(0);
    expect(read(rootDir, FRONTEND)).toBe(
      manifest("frontend", "0.7.103", '\n  "license": "MIT",'),
    );
    expect(git(rootDir, ["diff", "--name-only", "--diff-filter=U"])).toBe("");
    git(rootDir, ["commit", "-q", "--no-edit"]);

    bumpVersions(rootDir, mainOid(rootDir));
    expect(read(rootDir, FRONTEND)).toBe(
      manifest("frontend", "0.7.104", '\n  "license": "MIT",'),
    );
  });

  test("keeps the branch's deliberate minor release", () => {
    const rootDir = repository();
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    write(rootDir, FRONTEND, manifest("frontend", "0.8.0"));
    commitAll(rootDir, "feat: release frontend 0.8");
    commitOnMain(rootDir, {
      [FRONTEND]: manifest("frontend", "0.7.103", '\n  "license": "MIT",'),
    });
    expect(mergeMain(rootDir)).not.toBe(0);

    expect(resolveVersionConflicts(rootDir)).toBe(0);
    expect(read(rootDir, FRONTEND)).toBe(
      manifest("frontend", "0.8.0", '\n  "license": "MIT",'),
    );
    git(rootDir, ["commit", "-q", "--no-edit"]);
    expect(checkVersions(rootDir, mainOid(rootDir))).toBe(0);
  });

  test("touches nothing when another file conflicts", () => {
    const rootDir = repository();
    write(rootDir, "README.md", "branch\n");
    write(rootDir, FRONTEND, manifest("frontend", "0.7.102"));
    commitAll(rootDir, "feat: change readme");
    commitOnMain(rootDir, {
      "README.md": "main\n",
      [FRONTEND]: manifest("frontend", "0.7.103"),
    });
    expect(mergeMain(rootDir)).not.toBe(0);
    const before = read(rootDir, FRONTEND);

    expect(resolveVersionConflicts(rootDir)).toBe(1);
    expect(read(rootDir, FRONTEND)).toBe(before);
    expect(git(rootDir, ["diff", "--name-only", "--diff-filter=U"])).toContain(
      FRONTEND,
    );
  });

  test("refuses a manifest that conflicts beyond its version", () => {
    const rootDir = repository();
    write(
      rootDir,
      FRONTEND,
      manifest("frontend", "0.7.102", '\n  "license": "ISC",'),
    );
    commitAll(rootDir, "chore: license");
    commitOnMain(rootDir, {
      [FRONTEND]: manifest("frontend", "0.7.103", '\n  "license": "MIT",'),
    });
    expect(mergeMain(rootDir)).not.toBe(0);

    expect(resolveVersionConflicts(rootDir)).toBe(1);
  });

  test("requires a merge in progress", () => {
    expect(resolveVersionConflicts(repository())).toBe(1);
  });
});

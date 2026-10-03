import { describe, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import {
  commitAll,
  commitOnMain,
  FRONTEND,
  git,
  mainOid,
  read,
  write,
} from "./version.testUtils";
import { versionPreparationFixture } from "./versionPreparation.testUtils";

describe("prepareVersions CLI failures", () => {
  for (const dirty of ["staged", "unstaged", "untracked"]) {
    test(`rejects a ${dirty} change without touching the checkout`, () => {
      const fixture = versionPreparationFixture();
      const { rootDir } = fixture;
      write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
      commitAll(rootDir, "feat: change frontend");
      write(
        rootDir,
        dirty === "untracked" ? "scratch.txt" : "README.md",
        "local\n",
      );
      if (dirty === "staged") git(rootDir, ["add", "README.md"]);
      const before = git(rootDir, ["status", "--porcelain"]);
      const lock = read(rootDir, "bun.lock");
      const manifest = read(rootDir, FRONTEND);
      const result = fixture.prepare(mainOid(rootDir));
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("clean committed worktree");
      expect(result.stdout).toBe("");
      expect(git(rootDir, ["status", "--porcelain"])).toBe(before);
      expect(read(rootDir, "bun.lock")).toBe(lock);
      expect(read(rootDir, FRONTEND)).toBe(manifest);
    });
  }

  test("requires a full, integrated base OID before making changes", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    expect(fixture.prepare("main").stderr).toContain("full Git OID");
    const base = commitOnMain(rootDir, { "README.md": "main advanced\n" });
    const head = git(rootDir, ["rev-parse", "HEAD"]);
    const result = fixture.prepare(base);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Merge the pinned base");
    expect(git(rootDir, ["rev-parse", "HEAD"])).toBe(head);
    expect(git(rootDir, ["status", "--porcelain"])).toBe("");
  });

  for (const stage of ["install", "validation", "commit"]) {
    test(`restores manifests, lockfile, and index after ${stage} fails`, () => {
      const fixture = versionPreparationFixture();
      const { rootDir } = fixture;
      const base = mainOid(rootDir);
      write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
      if (stage === "install") {
        const root = JSON.parse(read(rootDir, "package.json"));
        root.dependencies = { missing: "file:missing-package" };
        write(rootDir, "package.json", `${JSON.stringify(root)}\n`);
      } else if (stage === "validation") {
        write(rootDir, "scripts/lint.ts", "process.exit(41);\n");
      } else {
        write(rootDir, ".git/hooks/pre-commit", "#!/bin/sh\nexit 42\n");
        git(rootDir, ["config", "core.hooksPath", "/dev/null"]);
      }
      const start = commitAll(rootDir, "feat: change frontend");
      const before = read(rootDir, FRONTEND);
      const lock = read(rootDir, "bun.lock");
      if (stage === "commit") {
        // Git only runs executable hooks; chmod happens in the isolated fixture.
        chmodSync(`${rootDir}/.git/hooks/pre-commit`, 0o755);
        git(rootDir, ["config", "core.hooksPath", ".git/hooks"]);
      }
      const result = fixture.prepare(base);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("0.7.101 -> 0.7.102");
      expect(result.stderr).toContain("Restored version manifests");
      expect(result.stdout).toBe("");
      expect(git(rootDir, ["rev-parse", "HEAD"])).toBe(start);
      expect(git(rootDir, ["status", "--porcelain"])).toBe("");
      expect(read(rootDir, FRONTEND)).toBe(before);
      expect(read(rootDir, "bun.lock")).toBe(lock);
      expect(fixture.run("checkVersions", [base]).code).toBe(1);
      if (stage === "commit") {
        git(rootDir, ["config", "core.hooksPath", "/dev/null"]);
        expect(fixture.prepare(base).code).toBe(0);
        expect(fixture.lockVersion("packages/windowing")).toBe("0.7.102");
      }
    });
  }

  test("preserves unexpected changes instead of committing or discarding them", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    write(
      rootDir,
      "scripts/lint.ts",
      'import { writeFileSync } from "node:fs";\nwriteFileSync("README.md", "external change\\n");\n',
    );
    const start = commitAll(rootDir, "feat: change frontend");
    const result = fixture.prepare(mainOid(rootDir));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Unexpected changes");
    expect(result.stderr).toContain("Preserved intermediate state");
    expect(git(rootDir, ["rev-parse", "HEAD"])).toBe(start);
    expect(read(rootDir, "README.md")).toBe("external change\n");
  });

  test("detects unexpected staged edits even when the worktree matches HEAD", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    write(
      rootDir,
      "scripts/lint.ts",
      `import { writeFileSync } from "node:fs";
writeFileSync("README.md", "external change\\n");
Bun.spawnSync(["git", "add", "README.md"]);
Bun.spawnSync(["git", "restore", "--worktree", "--source=HEAD", "README.md"]);
`,
    );
    const start = commitAll(rootDir, "feat: change frontend");
    const result = fixture.prepare(mainOid(rootDir));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Unexpected changes");
    expect(result.stderr).toContain("Preserved intermediate state");
    expect(git(rootDir, ["rev-parse", "HEAD"])).toBe(start);
    expect(read(rootDir, "README.md")).toBe("demo\n");
    expect(git(rootDir, ["show", ":README.md"])).toBe("external change");
  });

  test("rejects a commit hook that changes the prepared tree and preserves its commit", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    const start = commitAll(rootDir, "feat: change frontend");
    write(
      rootDir,
      ".git/hooks/pre-commit",
      "#!/bin/sh\nprintf 'hook change\\n' > README.md\ngit add README.md\n",
    );
    chmodSync(`${rootDir}/.git/hooks/pre-commit`, 0o755);
    const result = fixture.prepare(mainOid(rootDir));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("version commit differs");
    expect(result.stderr).toContain("Preserved intermediate state");
    expect(result.stdout).toBe("");
    expect(git(rootDir, ["rev-parse", "HEAD"])).not.toBe(start);
    expect(read(rootDir, "README.md")).toBe("hook change\n");
  });
});

import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  BACKEND,
  commitAll,
  commitOnMain,
  FRONTEND,
  git,
  mainOid,
  manifest,
  mergeMain,
  read,
  write,
} from "./version.testUtils";
import { versionPreparationFixture } from "./versionPreparation.testUtils";

describe("prepareVersions CLI", () => {
  test("commits only changed manifests and the matching real Bun lockfile", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    const base = mainOid(rootDir);
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    const startHead = commitAll(rootDir, "feat: change frontend");

    const result = fixture.prepare(
      base,
      path.join(rootDir, "packages/windowing"),
    );
    expect(result.code).toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(receipt).toEqual({
      schemaVersion: 1,
      baseOid: base,
      startHead,
      headOid: git(rootDir, ["rev-parse", "HEAD"]),
      committed: true,
      lockfileChanged: true,
      versions: [{ manifest: FRONTEND, from: "0.7.101", to: "0.7.102" }],
    });
    expect(git(rootDir, ["log", "-1", "--format=%s"])).toBe(
      "chore: bump package versions",
    );
    expect(
      git(rootDir, ["show", "--format=", "--name-only", "HEAD"]).split("\n"),
    ).toEqual(["bun.lock", FRONTEND]);
    expect(fixture.lintPaths()).toEqual(["bun.lock", FRONTEND]);
    expect(fixture.lockVersion("packages/windowing")).toBe("0.7.102");
    expect(fixture.lockVersion("packages/agent-tool")).toBe("0.2.0");
    expect(read(rootDir, BACKEND)).toBe(manifest("backend", "0.2.0"));
    expect(git(rootDir, ["status", "--porcelain"])).toBe("");
    expect(fixture.run("checkVersions", [base]).code).toBe(0);
  });

  test("a repeat preserves the reviewed commit without another bump", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    const base = mainOid(rootDir);
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    commitAll(rootDir, "feat: change frontend");
    expect(fixture.prepare(base).code).toBe(0);
    const reviewed = git(rootDir, ["rev-parse", "HEAD"]);
    const result = fixture.prepare(base);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      headOid: reviewed,
      committed: false,
      lockfileChanged: false,
      versions: [],
    });
    expect(fixture.lockVersion("packages/windowing")).toBe("0.7.102");
  });

  test("recomputes past a competing base bump after integrating main", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    commitAll(rootDir, "feat: change frontend");
    expect(fixture.prepare(mainOid(rootDir)).code).toBe(0);
    const base = commitOnMain(rootDir, {
      [FRONTEND]: manifest("frontend", "0.7.102"),
      "bun.lock": read(rootDir, "bun.lock"),
      "packages/windowing/src/other.ts": "export const b = 1;\n",
    });
    expect(mergeMain(rootDir)).toBe(0);
    const result = fixture.prepare(base);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).versions).toEqual([
      { manifest: FRONTEND, from: "0.7.102", to: "0.7.103" },
    ]);
    expect(fixture.lockVersion("packages/windowing")).toBe("0.7.103");
    expect(fixture.run("checkVersions", [base]).code).toBe(0);
  });

  test("prepares a version-only conflict after the merge helper resolves it", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    write(rootDir, FRONTEND, manifest("frontend", "0.7.102"));
    commitAll(rootDir, "feat: change frontend");
    const base = commitOnMain(rootDir, {
      [FRONTEND]: manifest("frontend", "0.7.103"),
    });
    expect(mergeMain(rootDir)).not.toBe(0);
    expect(fixture.prepare(base).code).not.toBe(0);
    expect(fixture.run("resolveVersionConflicts").code).toBe(0);
    git(rootDir, ["commit", "-q", "--no-edit"]);
    expect(fixture.prepare(base).code).toBe(0);
    expect(fixture.lockVersion("packages/windowing")).toBe("0.7.104");
    expect(fixture.run("checkVersions", [base]).code).toBe(0);
  });

  test("refreshes a stale lockfile for a deliberate release and a new package", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    const base = mainOid(rootDir);
    write(rootDir, FRONTEND, manifest("frontend", "0.8.0"));
    write(rootDir, "packages/new/package.json", manifest("new", "1.2.3"));
    commitAll(rootDir, "feat: release and add workspace");
    const result = fixture.prepare(base);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      committed: true,
      lockfileChanged: true,
      versions: [],
    });
    expect(fixture.lockVersion("packages/windowing")).toBe("0.8.0");
    expect(fixture.lockVersion("packages/new")).toBe("1.2.3");
    expect(fixture.lintPaths()).toEqual(["bun.lock"]);
  });

  test("root-only changes produce no version commit", () => {
    const fixture = versionPreparationFixture();
    write(fixture.rootDir, "README.md", "updated\n");
    const head = commitAll(fixture.rootDir, "docs: update root readme");
    const result = fixture.prepare(mainOid(fixture.rootDir));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      headOid: head,
      committed: false,
      versions: [],
    });
    expect(fixture.lintPaths()).toEqual([]);
  });

  test("lockfile refresh disables install lifecycle scripts", () => {
    const fixture = versionPreparationFixture();
    const { rootDir } = fixture;
    const root = JSON.parse(read(rootDir, "package.json"));
    root.scripts.postinstall = "bun scripts/install.ts";
    write(rootDir, "package.json", `${JSON.stringify(root)}\n`);
    write(
      rootDir,
      "scripts/install.ts",
      'import { writeFileSync } from "node:fs";\nwriteFileSync("README.md", "install script ran\\n");\n',
    );
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    commitAll(rootDir, "feat: change frontend");
    const result = fixture.prepare(mainOid(rootDir));
    expect(result.code).toBe(0);
    expect(read(rootDir, "README.md")).toBe("demo\n");
    expect(git(rootDir, ["status", "--porcelain"])).toBe("");
  });
});

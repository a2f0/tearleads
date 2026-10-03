import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { bumpVersions, checkVersions, planVersions } from "./bumpVersions";
import {
  BACKEND,
  commitAll,
  commitOnMain,
  FRONTEND,
  git,
  mainOid,
  manifest,
  read,
  repository,
  write,
} from "./version.testUtils";

let stdout: string[] = [];
beforeEach(() => {
  stdout = [];
  spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => mock.restore());
describe("bumpVersions", () => {
  test("covers every registered package, including a third private workspace", () => {
    const root = repository();
    write(root, "packages/crypto/package.json", manifest("crypto", "2.3.4"));
    write(root, "packages/crypto/src/index.ts", "export {};\n");
    const base = commitAll(root, "chore: register package");
    write(
      root,
      "packages/crypto/src/index.ts",
      "export const changed = true;\n",
    );
    commitAll(root, "feat: update crypto");
    bumpVersions(root, base);
    expect(read(root, "packages/crypto/package.json")).toBe(
      manifest("crypto", "2.3.5"),
    );
    expect(read(root, FRONTEND)).toBe(manifest("frontend", "0.7.101"));
    expect(read(root, BACKEND)).toBe(manifest("backend", "0.2.0"));
  });

  test("root-only tooling changes do not bump unrelated packages", () => {
    const root = repository();
    write(root, "scripts/release.ts", "export {};\n");
    commitAll(root, "chore: add tooling");
    expect(checkVersions(root, mainOid(root))).toBe(0);
    expect(bumpVersions(root, mainOid(root))).toBe(0);
    expect(stdout).toEqual([]);
  });

  test("new packages keep their initial versions", () => {
    const root = repository();
    write(root, "packages/new/package.json", manifest("new", "1.2.3"));
    commitAll(root, "feat: add package");
    expect(checkVersions(root, mainOid(root))).toBe(0);
    expect(bumpVersions(root, mainOid(root))).toBe(0);
    expect(stdout).toEqual([]);
  });

  test("an unversioned workspace stops before any manifest is rewritten", () => {
    const root = repository();
    write(
      root,
      "packages/missing/package.json",
      '{"name":"missing","private":true}',
    );
    write(
      root,
      "packages/windowing/src/app.ts",
      "export const changed = true;\n",
    );
    commitAll(root, "feat: add unversioned package");
    expect(() => bumpVersions(root, mainOid(root))).toThrow(
      "no string version",
    );
    expect(read(root, FRONTEND)).toBe(manifest("frontend", "0.7.101"));
    expect(stdout).toEqual([]);
  });

  test("an existing workspace may initialize its previously absent version", () => {
    const root = repository();
    write(
      root,
      "packages/legacy/package.json",
      '{"name":"legacy","private":true}',
    );
    const base = commitAll(root, "chore: register legacy");
    write(root, "packages/legacy/package.json", manifest("legacy", "0.1.0"));
    commitAll(root, "chore: initialize version");
    expect(checkVersions(root, base)).toBe(0);
    expect(bumpVersions(root, base)).toBe(0);
  });

  test("patch-bumps only the packages the branch changes", () => {
    const rootDir = repository();
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    commitAll(rootDir, "feat: change frontend");
    const base = mainOid(rootDir);

    expect(checkVersions(rootDir, base)).toBe(1);
    expect(bumpVersions(rootDir, base)).toBe(0);

    expect(stdout.join("")).toBe(`${FRONTEND}\n`);
    expect(read(rootDir, FRONTEND)).toBe(manifest("frontend", "0.7.102"));
    expect(read(rootDir, BACKEND)).toBe(manifest("backend", "0.2.0"));
    commitAll(rootDir, "chore: bump package versions");
    expect(checkVersions(rootDir, base)).toBe(0);
  });

  test("is a no-op once the branch carries the bump", () => {
    const rootDir = repository();
    write(rootDir, "packages/agent-tool/src/app.ts", "export const b = 1;\n");
    write(rootDir, BACKEND, manifest("backend", "0.2.1"));
    commitAll(rootDir, "feat: change backend");

    expect(bumpVersions(rootDir, mainOid(rootDir))).toBe(0);
    expect(stdout).toEqual([]);
  });

  test("re-bumps past a base that took the same version first", () => {
    const rootDir = repository();
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    write(rootDir, FRONTEND, manifest("frontend", "0.7.102"));
    commitAll(rootDir, "feat: change frontend");
    const base = commitOnMain(rootDir, {
      "packages/windowing/src/other.ts": "export {};\n",
      [FRONTEND]: manifest("frontend", "0.7.102"),
    });
    git(rootDir, ["merge", "-q", "--no-edit", base]);

    expect(planVersions(rootDir, base)).toContainEqual({
      manifest: FRONTEND,
      baseVersion: "0.7.102",
      headVersion: "0.7.102",
      targetVersion: "0.7.103",
    });
    bumpVersions(rootDir, base);
    expect(read(rootDir, FRONTEND)).toBe(manifest("frontend", "0.7.103"));
  });

  test("returns a version-only change to the base version", () => {
    const rootDir = repository();
    write(rootDir, FRONTEND, manifest("frontend", "0.7.102"));
    commitAll(rootDir, "chore: stale bump");

    bumpVersions(rootDir, mainOid(rootDir));
    expect(read(rootDir, FRONTEND)).toBe(manifest("frontend", "0.7.101"));
  });

  test("counts manifest edits beyond the version as a change", () => {
    const rootDir = repository();
    write(
      rootDir,
      FRONTEND,
      manifest("frontend", "0.7.101", '\n  "license": "MIT",'),
    );
    commitAll(rootDir, "chore: add license");

    bumpVersions(rootDir, mainOid(rootDir));
    expect(read(rootDir, FRONTEND)).toBe(
      manifest("frontend", "0.7.102", '\n  "license": "MIT",'),
    );
  });

  test("keeps a deliberate minor release", () => {
    const rootDir = repository();
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    write(rootDir, FRONTEND, manifest("frontend", "0.8.0"));
    commitAll(rootDir, "feat: release frontend 0.8");

    expect(checkVersions(rootDir, mainOid(rootDir))).toBe(0);
  });

  test("refuses to overwrite uncommitted manifest edits", () => {
    const rootDir = repository();
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    commitAll(rootDir, "feat: change frontend");
    write(rootDir, FRONTEND, manifest("frontend", "0.7.101", '\n  "x": 1,'));

    expect(() => bumpVersions(rootDir, mainOid(rootDir))).toThrow(
      "uncommitted changes",
    );
  });

  test("refuses to drop staged manifest edits", () => {
    const rootDir = repository();
    write(rootDir, "packages/windowing/src/app.ts", "export const a = 1;\n");
    commitAll(rootDir, "feat: change frontend");
    write(rootDir, FRONTEND, manifest("frontend", "0.7.101", '\n  "x": 1,'));
    git(rootDir, ["add", FRONTEND]);
    write(rootDir, FRONTEND, manifest("frontend", "0.7.101"));

    expect(() => bumpVersions(rootDir, mainOid(rootDir))).toThrow(
      "uncommitted changes",
    );
  });

  test("requires a full base OID", () => {
    const rootDir = repository();
    expect(() => bumpVersions(rootDir, "main")).toThrow("full Git OID");
  });
});

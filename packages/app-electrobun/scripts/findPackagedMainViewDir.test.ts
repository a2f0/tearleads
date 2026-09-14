import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPackagedMainViewDir } from "./findPackagedMainViewDir";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tearleads-packaged-view-"));
  roots.push(root);
  return root;
}

function mainView(root: string, bundle: string) {
  const view = join(root, bundle, "Resources/app/views/mainview");
  mkdirSync(view, { recursive: true });
  writeFileSync(join(view, "index.html"), "<html></html>");
  return view;
}

for (const bundle of ["Tearleads.app/Contents", "Tearleads", ""]) {
  test(`finds renderer resources in bundle layout ${bundle || "root"}`, () => {
    const root = fixture();
    const view = mainView(root, bundle);
    writeFileSync(join(root, "unrelated.txt"), "ignored");
    expect(findPackagedMainViewDir(root)).toBe(view);
  });
}

test("rejects a build without renderer output", () => {
  const root = fixture();
  mkdirSync(join(root, "Resources/app/views/mainview"), { recursive: true });
  expect(() => findPackagedMainViewDir(root)).toThrow("found 0");
});

test("rejects ambiguous output before either renderer can be replaced", () => {
  const root = fixture();
  mainView(root, "First.app/Contents");
  mainView(root, "Second.app/Contents");
  expect(() => findPackagedMainViewDir(root)).toThrow("found 2");
});

test("searches only the supplied build, ignoring sibling releases", () => {
  const root = fixture();
  mainView(root, "old-build/Tearleads.app/Contents");
  const currentBuild = join(root, "current-build");
  const view = mainView(currentBuild, "Tearleads.app/Contents");
  expect(findPackagedMainViewDir(currentBuild)).toBe(view);
});

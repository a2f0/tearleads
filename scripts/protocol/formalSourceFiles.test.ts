import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSourceFiles, walkFiles } from "./formalSourceFiles";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "formal-source-files-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

test("walkFiles returns matching files sorted, skipping build output, dot entries, and links", () => {
  const root = tree({
    "b.md": "b",
    "a.md": "a",
    "a.tla": "module",
    "nested/deeper/c.md": "c",
    "node_modules/pkg/d.md": "d",
    "dist/e.md": "e",
    ".hidden/f.md": "f",
    ".g.md": "g",
  });
  symlinkSync(join(root, "a.md"), join(root, "linked.md"));
  symlinkSync(join(root, "nested"), join(root, "linked-dir"));

  expect(walkFiles(root, (path) => path.endsWith(".md"))).toEqual([
    join(root, "a.md"),
    join(root, "b.md"),
    join(root, "nested/deeper/c.md"),
  ]);
});

test("readSourceFiles pairs each path with its contents", () => {
  const root = tree({ "x.tla": "---- MODULE X ----" });
  const path = join(root, "x.tla");
  expect(readSourceFiles([path])).toEqual([
    { content: "---- MODULE X ----", path },
  ]);
});

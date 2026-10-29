import { expect, test } from "bun:test";
import { findSurfaceViolations } from "./subsystemSurfaces";
import type { Subsystem } from "./subsystemTypes";

function subsystem(
  name: string,
  paths: readonly string[],
  surface?: readonly string[],
): Subsystem {
  return {
    name,
    package: "fixture",
    paths,
    responsibility: name,
    seam: name,
    ...(surface ? { surface } : {}),
  };
}

const registry = [
  subsystem("Alpha", ["pkg/a/"], ["pkg/a/index.ts"]),
  subsystem("Open", ["pkg/b/"]),
  subsystem("Gamma", ["pkg/c/"], ["pkg/c/index.ts", "pkg/c/contracts/"]),
];
const files = [
  "pkg/a/index.ts",
  "pkg/a/internal.ts",
  "pkg/b/open.ts",
  "pkg/c/index.ts",
  "pkg/c/contracts/types.ts",
  "pkg/c/impl.ts",
];

test("imports through a surface, into an open subsystem, or within one pass", () => {
  expect(
    findSurfaceViolations({
      baseline: {},
      files,
      imports: [
        { from: "pkg/b/open.ts", to: "pkg/a/index.ts" },
        { from: "pkg/a/internal.ts", to: "pkg/b/open.ts" },
        { from: "pkg/a/index.ts", to: "pkg/c/contracts/types.ts" },
        { from: "pkg/c/impl.ts", to: "pkg/c/index.ts" },
        { from: "pkg/a/index.ts", to: "pkg/a/internal.ts" },
      ],
      registry,
    }),
  ).toEqual([]);
});

test("a deep import into another subsystem fails unless it is baselined", () => {
  const imports = [{ from: "pkg/b/open.ts", to: "pkg/a/internal.ts" }];

  expect(
    findSurfaceViolations({ baseline: {}, files, imports, registry }),
  ).toEqual([
    "pkg/b/open.ts imports pkg/a/internal.ts, which is outside Alpha's surface",
  ]);
  expect(
    findSurfaceViolations({
      baseline: { "pkg/a/internal.ts": ["pkg/b/open.ts"] },
      files,
      imports,
      registry,
    }),
  ).toEqual([]);
});

test("a baseline entry that no longer occurs fails", () => {
  expect(
    findSurfaceViolations({
      baseline: { "pkg/c/impl.ts": ["pkg/a/internal.ts"] },
      files,
      imports: [{ from: "pkg/a/internal.ts", to: "pkg/c/index.ts" }],
      registry,
    }),
  ).toEqual([
    "pkg/a/internal.ts -> pkg/c/impl.ts no longer occurs; delete it from scripts/architecture/subsystemSurfaceBaseline.json",
  ]);
});

test("surface entries must name files inside their own subsystem", () => {
  expect(
    findSurfaceViolations({
      baseline: {},
      files,
      imports: [],
      registry: [
        subsystem("Alpha", ["pkg/a/"], ["pkg/a/missing.ts", "pkg/b/open.ts"]),
        subsystem("Open", ["pkg/b/"]),
      ],
    }),
  ).toEqual([
    "Alpha: surface entry pkg/a/missing.ts matches no file",
    "Alpha: surface entry pkg/b/open.ts is outside its paths",
  ]);
});

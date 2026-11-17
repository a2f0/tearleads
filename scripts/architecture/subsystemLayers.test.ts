import { expect, test } from "bun:test";
import { clientSdkLayers } from "./clientSdkLayers";
import { clientSdkSubsystems } from "./clientSdkSubsystems";
import { runtimeModuleSpecifiers } from "./subsystemImports";
import { findLayerViolations } from "./subsystemLayers";
import type { Subsystem } from "./subsystemTypes";

function subsystem(name: string, paths: readonly string[]): Subsystem {
  return {
    name,
    package: "fixture",
    paths,
    responsibility: name,
    seam: name,
  };
}

const registry = [
  subsystem("Base", ["pkg/base/"]),
  subsystem("Kernel", ["pkg/kernel/"]),
  subsystem("Policy", ["pkg/policy/"]),
  subsystem("Facade", ["pkg/facade/"]),
];
const layers = [["Base"], ["Kernel", "Policy"], ["Facade"]];

test("imports into lower subsystems or within one subsystem pass", () => {
  expect(
    findLayerViolations({
      baseline: {},
      imports: [
        { from: "pkg/facade/index.ts", to: "pkg/policy/index.ts" },
        { from: "pkg/policy/index.ts", to: "pkg/kernel/index.ts" },
        { from: "pkg/kernel/index.ts", to: "pkg/base/index.ts" },
        { from: "pkg/kernel/index.ts", to: "pkg/kernel/internal.ts" },
        { from: "pkg/kernel/index.ts", to: "outside/index.ts" },
      ],
      layers,
      registry,
    }),
  ).toEqual([]);
});

test("upward and same-layer-against-order imports fail unless baselined", () => {
  const imports = [
    { from: "pkg/base/index.ts", to: "pkg/facade/index.ts" },
    { from: "pkg/kernel/index.ts", to: "pkg/policy/index.ts" },
  ];

  expect(
    findLayerViolations({ baseline: {}, imports, layers, registry }),
  ).toEqual([
    "pkg/base/index.ts imports pkg/facade/index.ts, but Base (L0) sits below Facade (L2) in the subsystem layers",
    "pkg/kernel/index.ts imports pkg/policy/index.ts, but Kernel (L1) sits below Policy (L1) in the subsystem layers",
  ]);
  expect(
    findLayerViolations({
      baseline: {
        "pkg/facade/index.ts": ["pkg/base/index.ts"],
        "pkg/policy/index.ts": ["pkg/kernel/index.ts"],
      },
      imports,
      layers,
      registry,
    }),
  ).toEqual([]);
});

test("a baseline entry that no longer occurs fails", () => {
  expect(
    findLayerViolations({
      baseline: { "pkg/policy/index.ts": ["pkg/kernel/index.ts"] },
      imports: [{ from: "pkg/policy/index.ts", to: "pkg/kernel/index.ts" }],
      layers,
      registry,
    }),
  ).toEqual([
    "pkg/kernel/index.ts -> pkg/policy/index.ts no longer occurs; delete it from scripts/architecture/subsystemLayerBaseline.json",
  ]);
});

test("the layers name every subsystem exactly once", () => {
  expect(
    findLayerViolations({
      baseline: {},
      imports: [],
      layers: [["Base", "Unknown"], ["Kernel"], ["Facade", "Kernel"]],
      registry,
    }),
  ).toEqual([
    "subsystem layers name unknown subsystem Unknown",
    "Kernel appears more than once in the subsystem layers",
    "Policy has no subsystem layer",
  ]);
});

test("the runtime import reader skips type-only forms", () => {
  const source = [
    'import type { A } from "./typeOnly";',
    'import { type B, type C } from "./allTypeNamed";',
    'export type { D } from "./typeReExport";',
    'export { type E } from "./typeNamedReExport";',
    'type F = import("./importType").F;',
    'import { type G, h } from "./mixed";',
    'import i from "./default";',
    'import * as j from "./namespace";',
    'import "./sideEffect";',
    'export { k } from "./reExport";',
    'export * from "./starReExport";',
    'const l = await import("./dynamic");',
  ].join("\n");

  expect(runtimeModuleSpecifiers(source)).toEqual([
    "./mixed",
    "./default",
    "./namespace",
    "./sideEffect",
    "./reExport",
    "./starReExport",
    "./dynamic",
  ]);
});

test("the client SDK layers name every client SDK subsystem exactly once", () => {
  expect(
    findLayerViolations({
      baseline: {},
      imports: [],
      layers: clientSdkLayers,
      registry: clientSdkSubsystems,
    }),
  ).toEqual([]);
});

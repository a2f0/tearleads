import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPackage } from "./buildPackage";

// Installs the packed package into a fresh project, outside this workspace,
// renders a window from it, and bundles it: proof that what npm receives works
// on its own (resolution, peer React, types, stylesheets) before anyone
// publishes it.
const workDir = mkdtempSync(join(tmpdir(), "windowing-smoke-"));

// The consumer installs the same test libraries and TypeScript the workspace
// pins.
interface RootManifest {
  catalogs: Record<string, Record<string, string>>;
  devDependencies: { typescript: string };
}
const { catalogs, devDependencies }: RootManifest = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "..", "package.json"), "utf8"),
);
function catalogVersion(catalog: string, name: string) {
  const version = catalogs[catalog]?.[name];
  if (!version) {
    throw new Error(`${name} is missing from the ${catalog} catalog`);
  }
  return version;
}

// React at the lowest version the published peer range admits, so an API newer
// than the range claims fails here rather than in a consumer.
function peerFloor(distDir: string, name: string) {
  const manifest: { peerDependencies: Record<string, string> } = JSON.parse(
    readFileSync(join(distDir, "package.json"), "utf8"),
  );
  const range = manifest.peerDependencies[name];
  if (!range?.startsWith("^")) {
    throw new Error(`${name} needs a caret peer range, not ${range}`);
  }
  return range.slice(1);
}

function run(command: string[], cwd: string) {
  const [executable, ...args] = command;
  if (!executable) {
    throw new Error("empty command");
  }
  const result = spawnSync(executable, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} exited with ${result.status}`);
  }
}

const smokeTest = `import { expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import {
  useWindowActions,
  useWindowStateData,
  Window,
  WindowStateProvider,
} from "@tearleads/windowing";

function Notes() {
  return <p>notes body</p>;
}

function Desktop() {
  const { windows } = useWindowStateData();
  const { create } = useWindowActions();
  return (
    <>
      <button type="button" onClick={() => create("Notes", 0, 0, Notes)}>
        Open
      </button>
      <div style={{ position: "relative" }}>
        {windows.map((entry) => (
          <Window key={entry.id} windowId={entry.id} />
        ))}
      </div>
    </>
  );
}

test("the published package renders a window", () => {
  const view = render(
    <WindowStateProvider>
      <Desktop />
    </WindowStateProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Open" }));
  const region = view.getByRole("region", { name: "Notes" });
  expect(region.textContent).toContain("notes body");
});
`;

// TypeScript's defaults check declarations and side-effect imports, so a
// consumer's typecheck reaches everything the package's .d.ts files import.
const typecheckSource = `import { Window, WindowStateProvider } from "@tearleads/windowing";

export const desktop = (
  <WindowStateProvider>
    <Window windowId="notes" />
  </WindowStateProvider>
);
`;
const consumerTsconfig = JSON.stringify({
  compilerOptions: {
    jsx: "react-jsx",
    lib: ["ESNext", "DOM"],
    module: "esnext",
    moduleResolution: "bundler",
    noEmit: true,
    noUncheckedSideEffectImports: true,
    skipLibCheck: false,
    strict: true,
    target: "es2022",
  },
  include: ["typecheck.tsx"],
});

// Webpack skips modules package.json declares free of side effects, so it is
// the bundler that proves the token defaults survive a named import.
const bundleScript = `import MiniCssExtractPlugin from "mini-css-extract-plugin";
import webpack from "webpack";

const compiler = webpack({
  mode: "production",
  entry: "./bundleEntry.js",
  output: { path: new URL("./bundle", import.meta.url).pathname, module: true },
  experiments: { outputModule: true },
  externals: [/^react/, /^@phosphor-icons/],
  externalsType: "module",
  module: { rules: [{ test: /\\.css$/, use: [MiniCssExtractPlugin.loader, "css-loader"] }] },
  plugins: [new MiniCssExtractPlugin()],
});
compiler.run((error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error ?? stats.toString("errors-only"));
    process.exit(1);
  }
});
`;

function writeConsumer(projectDir: string, tarball: string, distDir: string) {
  mkdirSync(projectDir);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      dependencies: {
        "@tearleads/windowing": `file:${tarball}`,
        react: peerFloor(distDir, "react"),
        "react-dom": peerFloor(distDir, "react-dom"),
      },
      devDependencies: {
        "@happy-dom/global-registrator": catalogVersion(
          "testing",
          "@happy-dom/global-registrator",
        ),
        "@testing-library/react": catalogVersion(
          "testing",
          "@testing-library/react",
        ),
        "@types/react": catalogVersion("react", "@types/react"),
        "@types/react-dom": catalogVersion("react", "@types/react-dom"),
        "css-loader": "7.1.5",
        "mini-css-extract-plugin": "2.10.2",
        typescript: devDependencies.typescript,
        webpack: "5.111.1",
      },
      name: "windowing-smoke-consumer",
      private: true,
      type: "module",
    }),
    "bunfig.toml": '[test]\npreload = ["./happydom.ts"]\n',
    "happydom.ts":
      'import { GlobalRegistrator } from "@happy-dom/global-registrator";\nGlobalRegistrator.register();\nglobalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };\n',
    "smoke.test.tsx": smokeTest,
    "tsconfig.json": consumerTsconfig,
    "typecheck.tsx": typecheckSource,
    "bundle.js": bundleScript,
    "bundleEntry.js":
      'import { Window } from "@tearleads/windowing";\nconsole.log(Window);\n',
  };
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(projectDir, name), contents);
  }
}

try {
  const distDir = join(workDir, "dist");
  await buildPackage(distDir);
  run(["npm", "pack", "--pack-destination", workDir], distDir);
  const tarball = readdirSync(workDir).find((file) => file.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("npm pack produced no tarball");
  }

  const projectDir = join(workDir, "consumer");
  writeConsumer(projectDir, join(workDir, tarball), distDir);
  run(["bun", "install"], projectDir);
  run(["bun", "test"], projectDir);
  run(["bun", "x", "tsc", "-p", "."], projectDir);
  run(["node", "bundle.js"], projectDir);
  const css = readFileSync(join(projectDir, "bundle", "main.css"), "utf8");
  if (!css.includes("--color-dark:")) {
    throw new Error("the bundled stylesheet lost the token defaults");
  }
  console.log(
    "Smoke test passed: the packed package installs, renders, typechecks, and bundles.",
  );
} finally {
  rmSync(workDir, { force: true, recursive: true });
}

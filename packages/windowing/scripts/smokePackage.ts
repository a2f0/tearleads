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
// and renders a window from it: proof that what npm receives works on its own
// (resolution, peer React, stylesheets) before anyone publishes it.
const workDir = mkdtempSync(join(tmpdir(), "windowing-smoke-"));

// The consumer installs the same React and test libraries the workspace pins.
interface RootManifest {
  catalogs: Record<string, Record<string, string>>;
}
const { catalogs }: RootManifest = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "..", "package.json"), "utf8"),
);
function catalogVersion(catalog: string, name: string) {
  const version = catalogs[catalog]?.[name];
  if (!version) {
    throw new Error(`${name} is missing from the ${catalog} catalog`);
  }
  return version;
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

try {
  const distDir = join(workDir, "dist");
  await buildPackage(distDir);
  run(["npm", "pack", "--pack-destination", workDir], distDir);
  const tarball = readdirSync(workDir).find((file) => file.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("npm pack produced no tarball");
  }

  const projectDir = join(workDir, "consumer");
  mkdirSync(projectDir);
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify({
      dependencies: {
        "@tearleads/windowing": `file:${join(workDir, tarball)}`,
        react: catalogVersion("react", "react"),
        "react-dom": catalogVersion("react", "react-dom"),
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
      },
      name: "windowing-smoke-consumer",
      private: true,
      type: "module",
    }),
  );
  writeFileSync(
    join(projectDir, "bunfig.toml"),
    '[test]\npreload = ["./happydom.ts"]\n',
  );
  writeFileSync(
    join(projectDir, "happydom.ts"),
    'import { GlobalRegistrator } from "@happy-dom/global-registrator";\nGlobalRegistrator.register();\nglobalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };\n',
  );
  writeFileSync(
    join(projectDir, "smoke.test.tsx"),
    `import { expect, test } from "bun:test";
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
`,
  );
  run(["bun", "install"], projectDir);
  run(["bun", "test"], projectDir);
  console.log("Smoke test passed: the packed package installs and renders.");
} finally {
  rmSync(workDir, { force: true, recursive: true });
}

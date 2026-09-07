import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDependencyCruiserOptions } from "../dependencyCruiserConfig";

const cruiserBin = resolve(
  import.meta.dir,
  "../../node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
);

test("dependency scans observe manifest-only changes without source edits", async () => {
  const fixture = await mkdtemp(
    join(tmpdir(), "tearleads-dependency-manifest-"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const run = (command: string[]) => {
    const result = Bun.spawnSync(command, {
      cwd: fixture,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString();
  };
  const writeManifest = (production: boolean) =>
    Bun.write(
      join(fixture, "package.json"),
      JSON.stringify({
        name: "manifest-fixture",
        [production ? "dependencies" : "devDependencies"]: {
          "runtime-lib": "1.0.0",
        },
      }),
    );
  try {
    const { cache } = createDependencyCruiserOptions();
    await Bun.write(
      join(fixture, "rules.json"),
      JSON.stringify({
        options: {
          doNotFollow: { path: "node_modules" },
          cache: cache
            ? {
                ...(typeof cache === "object" ? cache : {}),
                folder: join(fixture, "cache"),
              }
            : false,
        },
      }),
    );
    await Bun.write(join(fixture, ".gitignore"), "node_modules/\ncache/\n");
    await Bun.write(
      join(fixture, "node_modules/runtime-lib/package.json"),
      JSON.stringify({
        name: "runtime-lib",
        version: "1.0.0",
        main: "index.js",
      }),
    );
    await Bun.write(
      join(fixture, "node_modules/runtime-lib/index.js"),
      "exports.value = 1;",
    );
    await Bun.write(join(fixture, "src/index.ts"), 'import "runtime-lib";');
    await writeManifest(false);
    run(["git", "init", "--quiet", "--template="]);
    run(["git", "add", "."]);
    run([
      "git",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=disabled-hooks",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    const scan = () => {
      const report = JSON.parse(
        run([
          process.execPath,
          cruiserBin,
          "--config",
          "rules.json",
          "--output-type",
          "json",
          "src",
        ]),
      ) as {
        modules: {
          source: string;
          dependencies: { dependencyTypes: string[] }[];
        }[];
      };
      return report.modules.find((module) => module.source === "src/index.ts")
        ?.dependencies[0]?.dependencyTypes;
    };
    expect(scan()).toContain("npm-dev");
    await writeManifest(true);
    expect(scan()).not.toContain("npm-dev");
    expect(scan()).toContain("npm");
    await writeManifest(false);
    expect(scan()).toContain("npm-dev");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 60_000);

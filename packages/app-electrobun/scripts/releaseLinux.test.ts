import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bunLaunchVariables,
  runLinuxNativeBuild,
  runLinuxRelease,
} from "./releaseLinux.testUtils";

const stagedPairs = [
  "bun/index.js",
  "bun/index.js.map",
  "chunk-a1.js",
  "chunk-a1.js.map",
]
  .map((file) => `staging-app-linux-x64/${file}`)
  .join(",");

for (const tier of ["staging", "production"]) {
  test(`${tier} builds x64 in Docker and publishes a matched installer and updater`, async () => {
    const result = await runLinuxRelease(["upload", tier]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(
      result.calls.find((call) => call.startsWith("docker build")),
    ).toContain("--platform linux/amd64");
    expect(result.context).toContain(
      "packages/app-electrobun/scripts/releaseLinux.sh",
    );
    for (const excluded of [".secrets", "node_modules", ".git/", "local.env"])
      expect(result.context).not.toContain(excluded);
    const uploads = result.calls.filter((call) => call.startsWith("upload"));
    expect(uploads).toHaveLength(5);
    expect(uploads[0]).toContain("-Setup.tar.gz ");
    expect(uploads[2]).toContain(".tar.zst ");
    expect(uploads[3]).toContain("-update.json");
    expect(uploads[4]).toContain("-download.json");
    const discovery = JSON.parse(result.published[result.discovery] ?? "{}");
    expect(result.published[discovery.installer]).toBe("installer\n");
    expect(result.published[discovery.checksum]).toContain(
      `  ${discovery.installer}\n`,
    );
    expect(result.published["previous-Setup.tar.gz"]).toBe(
      "previous installer\n",
    );
    expect(result.calls.at(-1)).toBe("docker rm test-container");
  });
}

test("the host uploads the container's staged maps under HEAD before publishing, outside the artifacts", async () => {
  const result = await runLinuxRelease(["upload", "staging"]);
  expect(result.exitCode, result.stderr).toBe(0);
  const upload = result.calls.indexOf(
    `sourcemaps staging linux-x64 head outside ${stagedPairs}`,
  );
  expect(upload).toBeGreaterThan(
    result.calls.findIndex((call) => call.startsWith("docker run")),
  );
  expect(upload).toBeLessThan(
    result.calls.findIndex((call) => call.startsWith("upload")),
  );
  const bun = result.calls.filter((call) => call.startsWith("bun "));
  expect(bun).toHaveLength(2);
  expect(bun[0]).toStartWith("bun --no-env-file --config=/dev/null /");
  expect(bun[0]).toContain("/uploadLinuxSourceMaps.ts staging linux-x64 ");
  expect(bun[1]).toContain("/publishLinuxRelease.ts ");
  expect(result.built.filter((path) => path.endsWith(".map"))).toEqual([]);
});

test("no token reaches Docker's arguments, build context or any child", async () => {
  const result = await runLinuxRelease(["upload", "production"]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).not.toContain("token-leak");
  expect(result.context).not.toContain(".secrets");
  expect(
    result.calls.find((call) => call.startsWith("docker build")),
  ).not.toContain("SENTRY_AUTH_TOKEN");
});

for (const failure of ["sourcemap-upload", "partial"]) {
  test(`${failure} failure stops publishing`, async () => {
    const result = await runLinuxRelease(["upload", "production"], failure);
    expect(result.exitCode).not.toBe(0);
    expect(result.calls.some((call) => call.startsWith("sourcemaps"))).toBe(
      true,
    );
    expect(result.calls.some((call) => call.startsWith("upload"))).toBe(false);
    expect(result.published[result.discovery]).toBe("previous discovery\n");
  });
}

test("no release step or Bun process inherits Bun launch variables", async () => {
  const directory = mkdtempSync(join(tmpdir(), "linux-release-launch-"));
  try {
    const mark = join(directory, "preloaded");
    const preload = join(directory, "preload.ts");
    writeFileSync(
      preload,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(mark)}, "");\n`,
    );
    const result = await runLinuxRelease(["upload", "staging"], "", {
      ...Object.fromEntries(
        bunLaunchVariables.map((name) => [name, "hostile"]),
      ),
      BUN_OPTIONS: `--preload=${preload}`,
      BUN_INSPECT_PRELOAD: preload,
    });
    expect(
      result.calls.filter((call) => call.startsWith("bun-launch")),
    ).toEqual([]);
    expect(existsSync(mark)).toBe(false);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Download:");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const failure of [
  "build",
  "missing",
  "smoke",
  "payload",
  "checksum",
  "metadata",
  "unstaged",
]) {
  test(`${failure} failure preserves download discovery`, async () => {
    const result = await runLinuxRelease(["upload", "production"], failure);
    expect(result.exitCode).not.toBe(0);
    expect(result.published[result.discovery]).toBe("previous discovery\n");
    expect(result.stdout).not.toContain("Download:");
    if (["build", "missing", "smoke", "unstaged"].includes(failure)) {
      expect(result.calls.some((call) => call.startsWith("upload"))).toBe(
        false,
      );
      expect(result.calls.some((call) => call.startsWith("sourcemaps"))).toBe(
        false,
      );
    }
  });
}

for (const suffix of ["Setup.tar.gz", "update.json", "tar.zst"]) {
  test(`a container artifact linked to a host file (${suffix}) is refused before copying`, async () => {
    const result = await runLinuxRelease(
      ["build", "production"],
      `link-${suffix}`,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("non-regular Linux release artifact");
    expect(result.built).toEqual([]);
    const upload = await runLinuxRelease(
      ["upload", "staging"],
      `link-${suffix}`,
    );
    expect(upload.exitCode).toBe(1);
    expect(
      upload.calls.some((call) => /^(upload|sourcemaps|bun)/.test(call)),
    ).toBe(false);
    expect(Object.values(upload.published).join()).not.toContain(
      "SENTRY_AUTH_TOKEN",
    );
  });
}

test("build mode leaves AWS and Sentry untouched", async () => {
  const result = await runLinuxRelease(["build", "production"]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).not.toContain("credentials");
  expect(result.calls.some((call) => call.startsWith("upload"))).toBe(false);
  expect(result.calls.some((call) => call.startsWith("bun"))).toBe(false);
  expect(result.calls).not.toContain("token-leak");
});

for (const field of ["platform", "arch", "channel"]) {
  test(`Linux rejects an update manifest with the wrong ${field} before publishing`, async () => {
    const result = await runLinuxRelease(
      ["upload", "production"],
      `manifest-${field}`,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Update manifest does not match");
    expect(result.calls.some((call) => call.startsWith("upload"))).toBe(false);
    expect(result.published[result.discovery]).toBe("previous discovery\n");
  });
}

test("container cleanup failure preserves the successful publication result", async () => {
  const result = await runLinuxRelease(["upload", "production"], "cleanup");
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("Download:");
  expect(result.stderr).toContain("Could not remove release container");
});

for (const [change, excluded] of [
  ["deleted", ".gitignore"],
  ["untracked", "bunfig.toml"],
]) {
  test(`build mode accepts local edits (${change}) but sends only tracked files`, async () => {
    const result = await runLinuxRelease(["build", "production"], change);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.context).not.toContain(excluded);
  });
}

for (const change of ["dirty", "staged", "untracked"]) {
  test(`${change} source cannot be uploaded and stops before secrets or any Bun process`, async () => {
    const result = await runLinuxRelease(["upload", "production"], change, {
      GIT_DIR: "/clean/checkout/elsewhere",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("require a clean Git checkout");
    expect(result.calls).toEqual([]);
  });
}

for (const args of [[], ["upload", "prod"], ["build", "production", "extra"]]) {
  test(`invalid arguments ${args.join(" ")} do not invoke Docker or AWS`, async () => {
    const result = await runLinuxRelease(args);
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
}

for (const { tier, channel } of [
  { tier: "staging", channel: "canary" },
  { tier: "production", channel: "stable" },
]) {
  test(`the ${tier} container build defers its source-map upload`, async () => {
    const result = await runLinuxNativeBuild(tier);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.build).toBe(`${tier}|deferred|--env=${channel}`);
  });
}

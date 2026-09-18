import { execFileSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  windowsArtifactDigest,
  windowsReleaseNames,
} from "./windowsReleaseArtifacts";

const ghStub = `import { appendFileSync, cpSync, mkdirSync } from "node:fs";
const args = process.argv.slice(2);
const { WINDOWS_TEST_LOG: log, WINDOWS_TEST_COMMIT: commit, WINDOWS_TEST_FAILURE: failure, WINDOWS_TEST_ROOT: root } = process.env;
appendFileSync(log, "gh " + args.join(" ") + "\\n");
if (args[0] === "repo") console.log("fixture/windows");
else if (args[0] === "api") {
  if (args[1].includes("git/ref/heads")) console.log(JSON.stringify({ object: { sha: failure === "unpushed" ? "b".repeat(40) : commit } }));
  else console.log(JSON.stringify({ event: failure === "wrong-event" ? "pull_request" : "workflow_dispatch", conclusion: failure === "failed-run" ? "failure" : "success", head_sha: failure === "wrong-commit" ? "b".repeat(40) : commit, path: failure === "wrong-workflow" ? ".github/workflows/ci.yml" : ".github/workflows/electrobun-windows.yml" }));
} else if (args[0] === "workflow") {
  if (args[args.indexOf("--ref") + 1] !== "release/fixture") process.exit(8);
} else if (args[0] === "run" && args[1] === "download") {
  const maps = args[args.indexOf("--name") + 1].includes("-maps-");
  if ((!maps && failure === "missing-artifact") || (maps && failure === "missing-maps")) process.exit(9);
  const destination = args[args.indexOf("--dir") + 1];
  mkdirSync(destination, { recursive: true });
  if (maps) await Bun.write(destination + "/fixture", "maps");
  else cpSync(root + "/fixture-artifacts", destination, { recursive: true });
} else process.exit(7);
`;

const sentryStub = `import { appendFileSync } from "node:fs";
export async function runDeferredSourceMapUpload(options) {
  const { WINDOWS_TEST_LOG: log, WINDOWS_TEST_COMMIT: commit, WINDOWS_TEST_FAILURE: failure } = process.env;
  if (process.env.SENTRY_AUTH_TOKEN) throw new Error("Upload token leaked to the child environment");
  if (options.commit !== commit || options.target !== "win-x64" || !await Bun.file(options.stagingDir + "/fixture").exists()) throw new Error("Wrong source maps");
  appendFileSync(log, "sentry " + options.tier + " " + options.target + "\\n");
  if (failure === "sentry") throw new Error("Sentry upload failed");
}
`;

export async function runWindowsRelease(
  action: string,
  tier: string,
  failure = "",
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "windows-cli-test-")),
  );
  const { PATH: inheritedPath } = process.env;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Release test",
        "-c",
        "user.email=test@example.invalid",
        ...args,
      ],
      { cwd: root, env, encoding: "utf8" },
    ).trim();
  async function write(path: string, text: string) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, text);
    await chmod(destination, 0o755);
  }
  try {
    const scripts = join(root, "packages/app-electrobun/scripts");
    await mkdir(scripts, { recursive: true });
    for (const file of [
      "releaseWindows.ts",
      "publishWindowsRelease.ts",
      "publishDesktopRelease.ts",
      "windowsReleaseArtifacts.ts",
      "sentryReleaseSource.ts",
    ])
      await cp(join(import.meta.dirname, file), join(scripts, file));
    await write(
      "packages/app-electrobun/scripts/uploadDeferredSourceMaps.ts",
      sentryStub,
    );
    await write(
      "packages/app-electrobun/scripts/sentryCliUpload.ts",
      "export const hostedSentryEndpoint = {};\n",
    );
    await write(
      "scripts/windowsRelease.sh",
      await Bun.file(
        resolve(import.meta.dirname, "../../../scripts/windowsRelease.sh"),
      ).text(),
    );
    await write(
      "terraform/scripts/common.sh",
      "load_secrets_env() { export SENTRY_AUTH_TOKEN=fixture-token; }\nvalidate_aws_env() { :; }\n",
    );
    await write(
      ".gitignore",
      "node_modules/\nbin/\nfixture-artifacts/\ncalls.log\npackages/app-electrobun/build/\n",
    );
    await symlink(
      resolve(import.meta.dirname, "../node_modules"),
      join(root, "node_modules"),
    );
    git("init", "-q", "-b", "release/fixture");
    git("add", ".");
    git("commit", "-qm", "fixture");
    const commit = git("rev-parse", "HEAD");
    await write("bin/gh.ts", ghStub);
    await write(
      "bin/gh",
      '#!/bin/sh\nexec "$WINDOWS_TEST_BUN" "$WINDOWS_TEST_ROOT/bin/gh.ts" "$@"\n',
    );
    await symlink(process.execPath, join(root, "bin/bun"));
    await write(
      "bin/aws",
      '#!/bin/sh\nprintf "aws %s\\n" "$*" >> "$WINDOWS_TEST_LOG"\n',
    );
    const names = windowsReleaseNames(tier);
    const artifacts = join(root, "fixture-artifacts");
    await write(`fixture-artifacts/${names.installer}`, "installer");
    await write(`fixture-artifacts/${names.archive}`, "archive");
    await write(
      `fixture-artifacts/${names.update}`,
      JSON.stringify({
        channel: names.channel,
        platform: "win",
        arch: "x64",
        identifier: "com.tearleads.app",
      }),
    );
    const sha256 = Object.fromEntries(
      await Promise.all(
        [names.installer, names.archive, names.update].map(async (name) => [
          name,
          await windowsArtifactDigest(join(artifacts, name)),
        ]),
      ),
    );
    await write(
      "fixture-artifacts/release.json",
      JSON.stringify({
        commit,
        tier: failure === "wrong-tier" ? "foreign" : tier,
        target: "win-x64",
        sha256,
      }),
    );
    if (failure === "corrupt-artifact")
      await write(`fixture-artifacts/${names.installer}`, "tampered");
    const log = join(root, "calls.log");
    const child = Bun.spawn(
      [
        "bash",
        join(root, "scripts/windowsRelease.sh"),
        action,
        tier,
        ...(action === "build" ? [] : ["123"]),
      ],
      {
        cwd: root,
        env: {
          ...env,
          PATH: `${root}/bin:${inheritedPath}`,
          WINDOWS_TEST_ROOT: root,
          WINDOWS_TEST_LOG: log,
          WINDOWS_TEST_COMMIT: commit,
          WINDOWS_TEST_FAILURE: failure,
          WINDOWS_TEST_BUN: process.execPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return {
      code,
      output: stdout + stderr,
      calls: (await Bun.file(log).exists())
        ? (await Bun.file(log).text()).trim().split("\n")
        : [],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

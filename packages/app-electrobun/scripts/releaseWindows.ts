import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { publishDesktopRelease } from "./publishDesktopRelease";
import { hostedSentryEndpoint } from "./sentryCliUpload";
import { desktopSentryCommit } from "./sentryReleaseSource";
import { runDeferredSourceMapUpload } from "./uploadDeferredSourceMaps";
import {
  assertWindowsRun,
  verifyWindowsDownload,
  windowsReleaseNames,
} from "./windowsReleaseArtifacts";

const [action, tier = "", runId, ...extra] = process.argv.slice(2);
if (
  !action ||
  !["build", "download", "upload"].includes(action) ||
  extra.length ||
  (action === "build" ? runId !== undefined : !/^\d+$/.test(runId ?? ""))
)
  throw new Error(
    "Usage: releaseWindows.ts <build|download|upload> <staging|production> [run-id]",
  );
windowsReleaseNames(tier);
const root = resolve(import.meta.dirname, "../../..");
const commit = desktopSentryCommit(root);
const gh = (...args: string[]) =>
  execFileSync("gh", args, { cwd: root, encoding: "utf8" }).trim();
const repo = gh(
  "repo",
  "view",
  "--json",
  "nameWithOwner",
  "-q",
  ".nameWithOwner",
);
if (action === "build") {
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (!branch)
    throw new Error(
      "Switch to a pushed branch before dispatching a Windows release",
    );
  const remote = JSON.parse(
    gh("api", `repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`),
  );
  if (remote.object?.sha !== commit)
    throw new Error(
      "Push this branch's HEAD before dispatching a Windows release",
    );
  gh(
    "workflow",
    "run",
    "electrobun-windows.yml",
    "--repo",
    repo,
    "--ref",
    branch,
    "-f",
    `tier=${tier}`,
  );
  console.log(
    `Dispatched ${tier} Windows build at ${commit}. Find the run ID with:\ngh run list --repo ${repo} --workflow electrobun-windows.yml --commit ${commit} --event workflow_dispatch`,
  );
} else {
  const run = JSON.parse(gh("api", `repos/${repo}/actions/runs/${runId}`));
  assertWindowsRun(run, commit);
  const temp = await mkdtemp(join(tmpdir(), "tearleads-windows-release-"));
  try {
    const artifacts = join(temp, "artifacts");
    gh(
      "run",
      "download",
      runId ?? "",
      "--repo",
      repo,
      "--name",
      `tearleads-windows-${tier}-${commit}`,
      "--dir",
      artifacts,
    );
    const names = await verifyWindowsDownload(artifacts, tier, commit);
    const output = join(
      root,
      "packages/app-electrobun/build/win-x64",
      tier,
      commit,
    );
    await mkdir(output, { recursive: true });
    await cp(artifacts, output, { recursive: true });
    console.log(
      `Verified ${tier} Windows package: ${join(output, names.installer)}`,
    );
    if (action === "upload") {
      const stagingDir = join(temp, "sentry-sourcemaps");
      gh(
        "run",
        "download",
        runId ?? "",
        "--repo",
        repo,
        "--name",
        `tearleads-windows-maps-${tier}-${commit}`,
        "--dir",
        stagingDir,
      );
      await runDeferredSourceMapUpload({
        repoRoot: root,
        tier,
        target: "win-x64",
        commit,
        stagingDir,
        env: process.env,
        endpoint: hostedSentryEndpoint,
      });
      await publishDesktopRelease({
        ...names,
        target: "win-x64",
        installer: join(artifacts, names.installer),
        update: join(artifacts, names.update),
        archive: join(artifacts, names.archive),
      });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

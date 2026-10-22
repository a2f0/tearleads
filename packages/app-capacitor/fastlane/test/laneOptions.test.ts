import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { requireRubyBundle } from "./support/requireRubyBundle";

const packageRoot = resolve(import.meta.dir, "../..");

// Environment fallbacks the options below read; the caller's must not leak in.
const optionEnvironmentNames = [
  "ANDROID_BUILD_NUMBER",
  "ANDROID_RELEASE_MERGED_PR_NUMBER",
  "ANDROID_RELEASE_PR_NUMBER",
  "ANDROID_VERSION_CODE",
  "APP_STORE_VERSION",
  "APPLE_BUILD_NUMBER",
  "APPLE_TEAM_ID",
  "DEVELOPMENT_TEAM",
  "FASTLANE_TEAM_ID",
  "GOOGLE_PLAY_RELEASE_STATUS",
  "GOOGLE_PLAY_TRACK",
  "GOOGLE_PLAY_TRACKS",
  "IOS_BUILD_NUMBER",
  "IOS_TEAM_ID",
  "IOS_VERSION",
  "TEAM_ID",
];

const laneOptionsScript = `
require "json"
require "fastlane"
Fastlane.load_actions
f = Fastlane::FastFile.new("fastlane/Fastfile")
results = {
  defaultTrack: f.send(:google_play_upload_track, {}),
  track: f.send(:google_play_upload_track, { track: "beta" }),
  queriedTrack: f.send(:google_play_tracks, { track: "beta" }),
  defaultQueriedTracks: f.send(:google_play_tracks, {}),
  releaseStatus: f.send(:google_play_release_status, {}),
  androidBuildNumber: f.send(:explicit_android_release_build_number, { build_number: "41" }),
  androidVersionCodeOption: f.send(:explicit_android_release_build_number, { version_code: "42" }),
  iosBuildNumber: f.send(:explicit_ios_release_build_number, { build_number: "43" }),
  iosAppleBuildNumberOption: f.send(:explicit_ios_release_build_number, { apple_build_number: "44" }),
  teamOption: f.send(:ios_team_id, { team_id: "OPTION", apple_team_id: "ALIAS" }),
  teamAliasOption: f.send(:ios_team_id, { apple_team_id: "ALIAS" }),
  iosVersion: f.send(:explicit_ios_release_version, { version: "2.0.0" }),
  iosAppleVersionOption: f.send(:explicit_ios_release_version, { apple_version: "2.0.1" }),
  mergedPrNumber: f.send(:configured_merged_release_pr_number, { merged_pr_number: "47" }, "ANDROID"),
  prNumberOption: f.send(:configured_merged_release_pr_number, { pr_number: "48" }, "ANDROID")
}
ENV["GOOGLE_PLAY_TRACK"] = "alpha"
results[:envTrack] = f.send(:google_play_upload_track, {})
ENV["ANDROID_VERSION_CODE"] = "45"
results[:androidVersionCodeEnv] = f.send(:explicit_android_release_build_number, {})
ENV["APPLE_BUILD_NUMBER"] = "46"
results[:iosAppleBuildNumberEnv] = f.send(:explicit_ios_release_build_number, {})
ENV["TEAM_ID"] = "SHARED"
results[:teamEnv] = f.send(:ios_team_id, {})
ENV["APP_STORE_VERSION"] = "2.0.2"
results[:iosAppleVersionEnv] = f.send(:explicit_ios_release_version, {})
ENV["ANDROID_RELEASE_PR_NUMBER"] = "49"
results[:prNumberEnv] = f.send(:configured_merged_release_pr_number, {}, "ANDROID")
puts JSON.generate(results)
`;

test("lanes take one name per option and keep their environment fallbacks", async () => {
  await requireRubyBundle();
  const environment = { ...process.env };
  for (const name of optionEnvironmentNames) {
    Reflect.deleteProperty(environment, name);
  }
  const child = Bun.spawn(["bundle", "exec", "ruby", "-e", laneOptionsScript], {
    cwd: packageRoot,
    env: {
      ...environment,
      FASTLANE_OPT_OUT_USAGE: "1",
      FASTLANE_SKIP_UPDATE_CHECK: "1",
      NATIVE_RELEASE_TIER: "production",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  expect(exitCode, stderr).toBe(0);

  expect(JSON.parse(stdout.trim().split("\n").at(-1) ?? "null")).toEqual({
    defaultTrack: "internal",
    track: "beta",
    queriedTrack: ["beta"],
    defaultQueriedTracks: ["production", "beta", "alpha", "internal"],
    releaseStatus: "completed",
    androidBuildNumber: 41,
    androidVersionCodeOption: null,
    iosBuildNumber: 43,
    iosAppleBuildNumberOption: null,
    teamOption: "OPTION",
    teamAliasOption: null,
    iosVersion: "2.0.0",
    iosAppleVersionOption: null,
    mergedPrNumber: 47,
    prNumberOption: null,
    envTrack: "alpha",
    androidVersionCodeEnv: 45,
    iosAppleBuildNumberEnv: 46,
    teamEnv: "SHARED",
    iosAppleVersionEnv: "2.0.2",
    prNumberEnv: 49,
  });
});

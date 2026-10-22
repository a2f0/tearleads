import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { requireRubyBundle } from "./support/requireRubyBundle";

const packageRoot = resolve(import.meta.dir, "../..");
const scratch = await mkdtemp(join(tmpdir(), "tearleads-fastlane-lanes-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

// Release options the lanes read from the environment, by prefix because some
// names are built at run time; the caller's values must not change results.
const releaseOptionPrefixes =
  /^(ANDROID|APP_STORE|APPLE|GOOGLE_PLAY|IOS|MATCH|SKIP|SUPPLY|TESTFLIGHT|VITE)_/;
const releaseOptionNames = ["DEVELOPMENT_TEAM", "FASTLANE_TEAM_ID", "TEAM_ID"];
const callerEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      !releaseOptionPrefixes.test(name) && !releaseOptionNames.includes(name),
  ),
);

/**
 * Loads the real Fastfile, runs `body` against it as `fastfile`, and returns
 * the JSON the body prints last. Secrets resolve to the scratch folder.
 */
async function runLanes(body: string, env: Record<string, string> = {}) {
  await requireRubyBundle();
  const script = [
    'require "json"',
    'require "fastlane"',
    "Fastlane.load_actions",
    'fastfile = Fastlane::FastFile.new("fastlane/Fastfile")',
    body,
  ].join("\n");
  const child = Bun.spawn(["bundle", "exec", "ruby", "-e", script], {
    cwd: packageRoot,
    env: {
      ...callerEnvironment,
      FASTLANE_OPT_OUT_USAGE: "1",
      FASTLANE_SKIP_UPDATE_CHECK: "1",
      NATIVE_RELEASE_SECRETS_DIR: scratch,
      NATIVE_RELEASE_TIER: "staging",
      ...env,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "null");
}

test("Play version codes count bundles uploaded outside any track", async () => {
  const jsonKey = join(scratch, "play.json");
  await Bun.write(jsonKey, "{}");
  const result = await runLanes(
    `
calls = []
client = Object.new
client.define_singleton_method(:begin_edit) { |package_name:| calls << "begin:#{package_name}" }
client.define_singleton_method(:aab_version_codes) { [3, 9] }
client.define_singleton_method(:apks_version_codes) { [] }
client.define_singleton_method(:abort_current_edit) { calls << "abort" }
fastfile.define_singleton_method(:google_play_supply_client) { client }
fastfile.define_singleton_method(:google_play_version_codes_by_track) do |tracks|
  tracks.to_h { |track| [track, track == "internal" ? ["4"] : []] }
end
latest = fastfile.send(:latest_google_play_build_number, %w[internal production])
next_build = fastfile.send(:next_android_release_build_number, { next_google_play: true })
puts JSON.generate(latest: latest, next: next_build[:build_number], calls: calls)
`,
    { GOOGLE_PLAY_JSON_KEY_FILE: jsonKey },
  );
  expect(result).toEqual({
    latest: [{ internal: ["4"], production: [] }, 9],
    next: 10,
    calls: [
      "begin:com.tearleads.staging.app",
      "abort",
      "begin:com.tearleads.staging.app",
      "abort",
    ],
  });
});

test("the signing keychain's cleanup restores the caller's default keychain", async () => {
  const result = await runLanes(`
commands = []
# Every fastlane shell helper (Actions.sh and the Action.sh that
# create_keychain uses to list keychains) runs through sh_control_output.
login = "    \\"/Users/me/Library/Keychains/login.keychain-db\\"\\n"
Fastlane::Actions.define_singleton_method(:sh_control_output) do |*command, **|
  command = command.join(" ")
  commands << command
  ["security default-keychain", "security list-keychains -d user"].include?(command) ? login : ""
end
FastlaneCore::Helper.define_singleton_method(:keychain_path) { |name| "/tmp/#{name}-db" }
restored = [true, false].map do |exists|
  commands.clear
  fastfile.define_singleton_method(:ios_signing_keychain_exists?) { |_name| exists }
  fastfile.send(:create_ios_signing_keychain, "tearleads-test", "secret")
  fastfile.send(:cleanup_ios_signing_keychain, "tearleads-test")
  commands.select { |command| command.start_with?("security default-keychain -s") }
end
puts JSON.generate(restored)
`);
  const login =
    'security default-keychain -s "/Users/me/Library/Keychains/login.keychain-db"';
  for (const commands of result) {
    expect(commands.at(0)).toContain("tearleads-test");
    expect(commands.at(-1)).toBe(login);
  }
});

test("external TestFlight distribution waits for build processing", async () => {
  const result = await runLanes(`
skip = ->(options) { fastfile.send(:testflight_skip_waiting_for_build_processing?, options) }
puts JSON.generate([
  skip.call({}),
  skip.call({ distribute_external: true }),
  skip.call({ distribute_external: true, skip_waiting_for_build_processing: true })
])
`);
  expect(result).toEqual([true, false, true]);
});

test("release lanes accept only a bundled config for the tier's app", async () => {
  const configs = {
    bundled: {
      appId: "com.tearleads.staging.app",
      server: { iosScheme: "capacitor" },
    },
    production: { appId: "com.tearleads.app" },
    liveReload: {
      appId: "com.tearleads.staging.app",
      server: { url: "http://192.168.1.20:5173" },
    },
  };
  for (const [name, config] of Object.entries(configs)) {
    await Bun.write(join(scratch, `${name}.json`), JSON.stringify(config));
  }
  const result = await runLanes(`
results = %w[bundled production liveReload missing].to_h do |name|
  path = File.join(${JSON.stringify(scratch)}, "#{name}.json")
  fastfile.send(:ensure_bundled_release_capacitor_config!, path, "Android", "bun run cap:sync:staging android")
  [name, "accepted"]
rescue FastlaneCore::Interface::FastlaneError => e
  [name, e.message]
end
puts JSON.generate(results)
`);
  expect(result).toEqual({
    bundled: "accepted",
    production: `Release Android builds must be fully bundled, but capacitor.config.json sets appId="com.tearleads.app" instead of "com.tearleads.staging.app". Run \`bun run cap:sync:staging android\` first.`,
    liveReload:
      "Release Android builds must be fully bundled, but capacitor.config.json sets server.url=http://192.168.1.20:5173 (usually a leftover live-reload URL). Run `bun run cap:sync:staging android` first.",
    missing: expect.stringContaining(
      `Could not load ${join(scratch, "missing.json")}`,
    ),
  });
});

test("release build numbers default to the PR merged last on the release date", async () => {
  const result = await runLanes(
    `
prs = [
  { number: 150, mergedAt: "2026-10-20T23:30:00Z", title: "older" },
  { number: 152, mergedAt: "2026-10-21T09:00:00Z", title: "morning" },
  { number: 153, mergedAt: "2026-10-21T17:00:00Z", title: "afternoon" },
  { number: 154, mergedAt: "2026-10-22T08:00:00Z", title: "next day" }
]
git_log = "1792569600\\u0000feat: one (#140)\\n1792605600\\u0000chore: no PR\\n1792591200\\u0000fix: two (#141)\\n"
commands = []
gh = { ok: true }
fastfile.define_singleton_method(:release_command_available?) { |_command| true }
fastfile.define_singleton_method(:release_command_output) do |*command|
  commands << command.first
  next [JSON.generate(prs), gh[:ok]] if command.first == "gh"

  # Like git log --since/--until, only the release date's commits come back.
  [command.include?("--since=2026-10-21 00:00") ? git_log : "", true]
end
resolve = lambda do |options, env_prefix = "ANDROID"|
  fastfile.send(:merged_release_pr_number, options, env_prefix)
rescue FastlaneCore::Interface::FastlaneError => e
  "error: #{e.message}"
end
results = {
  github: resolve.call({ merged_date: "2026-10-21" }),
  explicit: resolve.call({ merged_pr_number: "77", merged_date: "2026-10-21" }),
  env: (ENV["IOS_RELEASE_PR_NUMBER"] = "88"; resolve.call({}, "IOS")),
  invalid: resolve.call({ merged_pr_number: "0" }),
  badDate: resolve.call({ merged_date: "21/10/2026" }),
  noMatch: resolve.call({ merged_date: "2026-11-01" })
}
commands.clear
gh[:ok] = false
results[:gitFallback] = resolve.call({ merged_date: "2026-10-21" })
results[:fallbackCommands] = commands.dup
puts JSON.generate(results)
`,
    { TZ: "UTC" },
  );
  expect(result).toEqual({
    github: 153,
    explicit: 77,
    env: 88,
    invalid: "error: Merged release PR number must be positive.",
    badDate:
      "error: ANDROID_RELEASE_MERGED_DATE must be YYYY-MM-DD: 21/10/2026",
    noMatch:
      "error: Could not find a PR merged on 2026-11-01. Set ANDROID_RELEASE_PR_NUMBER or pass merged_pr_number:<number>.",
    // The squash subjects carry the PR number; the latest such commit wins.
    gitFallback: 141,
    fallbackCommands: ["gh", "git"],
  });
});

test("Android release lanes choose build numbers and Play upload options", async () => {
  const jsonKey = join(scratch, "play-upload.json");
  await Bun.write(jsonKey, "{}");
  await Bun.write(join(scratch, "tearleads-upload.keystore"), "");
  const result = await runLanes(
    `
fastfile.define_singleton_method(:merged_release_pr_number) { |_options, _prefix| 153 }
play = { latest: 4 }
fastfile.define_singleton_method(:latest_google_play_build_number) { |tracks| [{}, play[:latest]] }
number = lambda do |options|
  fastfile.send(:next_android_release_build_number, options)[:build_number]
rescue FastlaneCore::Interface::FastlaneError => e
  "error: #{e.message}"
end
numbers = {
  merged: number.call({}),
  next: number.call({ next_google_play: true }),
  explicit: number.call({ build_number: "9" }),
  gradleEnvironment: (ENV["ANDROID_VERSION_CODE"] = "11"; number.call({})),
  conflict: number.call({ build_number: "9", next_google_play: true }),
  aheadOfMerged: (ENV.delete("ANDROID_VERSION_CODE"); play[:latest] = 300; number.call({}))
}
aab = Fastlane::FastFile.const_get(:RELEASE_AAB_PATH)
assets = { assets: [aab, "/tmp/mapping.txt"] }
upload = fastfile.send(:upload_android_play_release_options, {}, assets)
override = fastfile.send(
  :upload_android_play_release_options,
  { track: "alpha", release_status: "draft", validate_only: true },
  { assets: [aab] }
)
signing = begin
  fastfile.send(:require_android_release_signing!)
  "ok"
rescue FastlaneCore::Interface::FastlaneError => e
  e.message
end
puts JSON.generate(
  numbers: numbers,
  upload: upload.slice(:package_name, :json_key, :mapping_paths, :track, :release_status, :validate_only, :skip_upload_metadata),
  aab: upload[:aab] == aab,
  override: override.slice(:track, :release_status, :validate_only, :mapping_paths),
  signing: signing
)
`,
    {
      GOOGLE_PLAY_JSON_KEY_FILE: jsonKey,
      ANDROID_KEYSTORE_STORE_PASS: "",
      ANDROID_KEYSTORE_KEY_PASS: "",
    },
  );
  expect(result.numbers).toEqual({
    merged: 153,
    next: 5,
    explicit: 9,
    gradleEnvironment: 11,
    conflict:
      "error: Use either build_number or next_google_play:true, not both.",
    aheadOfMerged: 301,
  });
  expect(result.upload).toEqual({
    package_name: "com.tearleads.staging.app",
    json_key: jsonKey,
    mapping_paths: ["/tmp/mapping.txt"],
    track: "internal",
    release_status: "completed",
    validate_only: false,
    skip_upload_metadata: true,
  });
  expect(result.aab).toBe(true);
  expect(result.override).toEqual({
    track: "alpha",
    release_status: "draft",
    validate_only: true,
  });
  expect(result.signing).toBe(
    `Android release signing is not configured. Missing ANDROID_KEYSTORE_STORE_PASS, ANDROID_KEYSTORE_KEY_PASS in the environment, ${join(scratch, "shared.env")}, or ${join(scratch, "app.env")}.`,
  );
});

test("iOS release lanes resolve the signing team and TestFlight groups", async () => {
  const result = await runLanes(
    `
attempt = lambda do |&block|
  block.call
rescue FastlaneCore::Interface::FastlaneError => e
  "error: #{e.message}"
end
build_number = lambda do |options|
  fastfile.send(:next_ios_release_build_number, options)[:build_number]
rescue FastlaneCore::Interface::FastlaneError => e
  "error: #{e.message}"
end
puts JSON.generate(
  buildNumbers: [
    build_number.call({ build_number: "5" }),
    (ENV["APPLE_BUILD_NUMBER"] = "6"; build_number.call({})),
    build_number.call({ build_number: "5", next_testflight: true })
  ],
  teamFromIosName: fastfile.send(:ios_team_id, {}),
  teamOption: fastfile.send(:ios_team_id, { team_id: "OPTION" }),
  missingTeam: attempt.call { ENV.delete("IOS_TEAM_ID"); ENV.delete("TEAM_ID"); fastfile.send(:require_ios_team_id!, {}) },
  groups: fastfile.send(:testflight_groups, { groups: " Staff, ,Beta " }),
  emptyGroups: fastfile.send(:testflight_groups, { groups: " , " }),
  externalWithoutGroups: attempt.call { fastfile.send(:require_testflight_distribution_options!, { distribute_external: true }) },
  submission: [
    fastfile.send(:testflight_skip_submission?, {}),
    fastfile.send(:testflight_skip_submission?, { distribute_external: true })
  ]
)
`,
    { IOS_TEAM_ID: "IOSTEAM", TEAM_ID: "SHARED" },
  );
  expect(result).toEqual({
    buildNumbers: [
      5,
      6,
      "error: Use either build_number or next_testflight:true, not both.",
    ],
    teamFromIosName: "IOSTEAM",
    teamOption: "OPTION",
    missingTeam:
      "error: iOS release signing requires IOS_TEAM_ID, APPLE_TEAM_ID, DEVELOPMENT_TEAM, FASTLANE_TEAM_ID, TEAM_ID, or the team_id:<id> Fastlane option.",
    groups: ["Staff", "Beta"],
    emptyGroups: null,
    externalWithoutGroups:
      "error: External TestFlight distribution requires TESTFLIGHT_GROUPS or groups:<name,name>.",
    submission: [true, false],
  });
});

test("iOS release lanes take the Xcode marketing version and create profiles with the API key", async () => {
  const project = await Bun.file(
    join(packageRoot, "ios/App/App.xcodeproj/project.pbxproj"),
  ).text();
  const versions = new Set(
    [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(
      (match) => match[1],
    ),
  );
  expect(versions.size).toBe(1);
  const [version] = versions;
  const result = await runLanes(`
calls = []
fastfile.define_singleton_method(:load_ios_release_secrets_env) {}
fastfile.define_singleton_method(:with_ios_signing_keychain) do |&block|
  calls << "keychain"
  block.call
end
fastfile.define_singleton_method(:app_store_connect_api_key_options) { { key_id: "KEY" } }
fastfile.define_singleton_method(:app_store_connect_api_key) { |options| "api-key:#{options[:key_id]}" }
fastfile.define_singleton_method(:match) { |options| calls << options }
fastfile.runner.execute(:profiles, :ios, {})
fastfile.runner.execute(:profiles, :ios, { force: true })
puts JSON.generate(
  version: fastfile.send(:ios_release_version, {}),
  explicitVersion: fastfile.send(:ios_release_version, { version: "2.0.0" }),
  calls: calls
)
`);
  const profile = {
    type: "appstore",
    app_identifier: "com.tearleads.staging.app",
    api_key: "api-key:KEY",
    readonly: false,
  };
  expect(result).toEqual({
    version,
    explicitVersion: "2.0.0",
    calls: [
      "keychain",
      { ...profile, force: false },
      "keychain",
      { ...profile, force: true },
    ],
  });
});

test("release URL guards fail as fastlane user errors", async () => {
  const result = await runLanes(`
ENV["VITE_API_BASE_URL"] = "https://api-staging.tearleads.com"
ENV["VITE_WS_URL"] = "wss://api.tearleads.com/events"
error = begin
  fastfile.send(:ensure_native_release_service_urls!)
  nil
rescue StandardError => e
  e
end
puts JSON.generate(error && { class: error.class.name, message: error.message })
`);
  expect(result).toEqual({
    class: "FastlaneCore::Interface::FastlaneError",
    message:
      "VITE_WS_URL must use api-staging.tearleads.com for a staging release.",
  });
});

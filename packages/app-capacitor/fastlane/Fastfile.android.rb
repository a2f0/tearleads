# frozen_string_literal: true

require 'date'
require 'json'
require 'open3'
require 'shellwords'
require 'time'
require_relative 'native_release_target'

ANDROID_DIR = File.expand_path('../android', __dir__)
ANDROID_ASSETS_DIR = File.join(ANDROID_DIR, 'app/src/main/assets')
ANDROID_BUILD_IMAGES_SCRIPT = File.expand_path('../scripts/buildAndroidImages.sh', __dir__)
ANDROID_BUILD_VARIANT = NATIVE_RELEASE_TARGET.fetch(:android_build_variant)
ANDROID_BUILD_VARIANT_TASK = ANDROID_BUILD_VARIANT.capitalize
ANDROID_RELEASE_KEYSTORE_PATH = File.join(NATIVE_SECRETS_DIR, 'tearleads-release.keystore')
ANDROID_RELEASE_SIGNING_ENV_NAMES = %w[
  ANDROID_KEYSTORE_STORE_PASS
  ANDROID_KEYSTORE_KEY_PASS
].freeze
DEBUG_APK_PATH = File.join(ANDROID_DIR, 'app/build/outputs/apk/debug/app-debug.apk')
ANDROID_OUTPUT_DIR = File.join(ANDROID_DIR, 'app/build/outputs')
RELEASE_APK_PATH = File.join(ANDROID_OUTPUT_DIR, "apk/#{ANDROID_BUILD_VARIANT}/app-#{ANDROID_BUILD_VARIANT}.apk")
RELEASE_AAB_PATH = File.join(ANDROID_OUTPUT_DIR, "bundle/#{ANDROID_BUILD_VARIANT}/app-#{ANDROID_BUILD_VARIANT}.aab")
RELEASE_MAPPING_PATH = File.join(ANDROID_OUTPUT_DIR, "mapping/#{ANDROID_BUILD_VARIANT}/mapping.txt")
RELEASE_NATIVE_DEBUG_SYMBOLS_PATH = File.join(
  ANDROID_OUTPUT_DIR,
  "native-debug-symbols/#{ANDROID_BUILD_VARIANT}/native-debug-symbols.zip"
)
RELEASE_PLAY_ASSET_PATHS = [
  RELEASE_AAB_PATH,
  RELEASE_MAPPING_PATH,
  RELEASE_NATIVE_DEBUG_SYMBOLS_PATH
].freeze
MERGED_GITHUB_PRS_COMMAND = [
  'gh',
  'pr',
  'list',
  '--state',
  'merged',
  '--json',
  'number,mergedAt,title',
  '--limit',
  '100'
].freeze
ANDROID_RELEASE_VERSION_CODE_PROPERTY = 'tearleadsVersionCode'
ANDROID_RELEASE_PR_PATTERN = /\(#(?<number>\d+)\)/

def connected_android_device_serials
  adb_output = `adb devices`
  serials = adb_output
            .lines
            .drop(1)
            .map(&:strip)
            .reject(&:empty?)
            .map { |line| line.split(/\s+/, 2) }
            .select { |parts| parts[1] == 'device' }
            .map { |parts| parts[0] }

  [serials, adb_output]
end

def requested_android_device_serial(serials)
  requested_serial = ENV.fetch('ANDROID_SERIAL', '').strip
  return nil if requested_serial.empty?
  return requested_serial if serials.include?(requested_serial)

  UI.important(
    "ANDROID_SERIAL=#{requested_serial} is not connected; falling back to auto-detected device."
  )
  nil
end

def preferred_android_device_serial(serials)
  serials.find { |serial| serial.start_with?('emulator-') } || serials.first
end

def android_gradle_command
  gradle_path = File.join(ANDROID_DIR, 'gradlew')
  wrapper_jar_path = File.join(ANDROID_DIR, 'gradle/wrapper/gradle-wrapper.jar')
  if File.file?(gradle_path) && File.executable?(gradle_path) && File.file?(wrapper_jar_path)
    return Shellwords.escape(gradle_path)
  end

  return 'mise exec -- gradle' if system('mise', '--version', out: File::NULL, err: File::NULL)

  UI.user_error!('Gradle is unavailable. Run `mise install` from the repo root.')
end

def run_android_gradle(*arguments)
  gradle_arguments = arguments.flatten.map { |argument| Shellwords.escape(argument.to_s) }.join(' ')
  sh("#{android_gradle_command} #{gradle_arguments} -p #{Shellwords.escape(ANDROID_DIR)}")
end

def resolve_android_device_serial
  serials, adb_output = connected_android_device_serials
  requested_serial = requested_android_device_serial(serials)
  return requested_serial unless requested_serial.nil?

  preferred_serial = preferred_android_device_serial(serials)
  return preferred_serial unless preferred_serial.nil?

  UI.user_error!(
    "No connected Android device/emulator found. `adb devices` output:\n#{adb_output}"
  )
end

def install_android_apk(apk_path)
  UI.user_error!("APK does not exist: #{apk_path}") unless File.exist?(apk_path)

  serial = resolve_android_device_serial
  escaped_serial = Shellwords.escape(serial)
  escaped_apk_path = Shellwords.escape(apk_path)

  sh("adb -s #{escaped_serial} wait-for-device")
  sh("adb -s #{escaped_serial} install -r #{escaped_apk_path}")
end

def ensure_release_capacitor_sync!
  ensure_bundled_release_capacitor_config!(
    File.join(ANDROID_ASSETS_DIR, 'capacitor.config.json'),
    'Android',
    "bun run #{NATIVE_CAPACITOR_SYNC_SCRIPT} android"
  )
end

def load_android_release_secrets_env
  load_native_release_secrets_env
end

def positive_android_integer(value, description)
  number = Integer(value.to_s, 10)
  UI.user_error!("#{description} must be positive.") unless number.positive?

  number
rescue ArgumentError, TypeError
  UI.user_error!("#{description} must be a positive integer: #{value}")
end

def android_command_available?(command)
  system('which', command, out: File::NULL, err: File::NULL)
end

def android_command_output(*command)
  output, status = Open3.capture2e(*command)

  [output, status.success?]
rescue Errno::ENOENT => e
  [e.message, false]
end

def android_pr_merged_at(pull_request)
  Time.parse(pull_request.fetch('mergedAt'))
end

def android_pr_merged_on_date?(pull_request, date)
  android_pr_merged_at(pull_request).localtime.to_date == date
end

def android_release_date(options)
  raw_date = lane_option(options, :merged_date, 'ANDROID_RELEASE_MERGED_DATE', Date.today.iso8601)

  Date.iso8601(raw_date.to_s)
rescue Date::Error
  UI.user_error!("ANDROID_RELEASE_MERGED_DATE must be YYYY-MM-DD: #{raw_date}")
end

def explicit_android_release_build_number(options)
  value = lane_option(options, :build_number, 'ANDROID_BUILD_NUMBER')
  value ||= lane_option(options, :version_code, 'ANDROID_VERSION_CODE')
  return nil if value.nil?

  positive_android_integer(value, 'Android release build number')
end

def next_google_play_build_number_requested?(options)
  lane_boolean_option(options, :next_google_play, 'ANDROID_RELEASE_NEXT_GOOGLE_PLAY', false)
end

def configured_android_release_pr_number(options)
  value = lane_option(options, :merged_pr_number, 'ANDROID_RELEASE_MERGED_PR_NUMBER')
  value ||= lane_option(options, :pr_number, 'ANDROID_RELEASE_PR_NUMBER')
  return nil if value.nil?

  positive_android_integer(value, 'Android release merged PR number')
end

def merged_github_prs_output
  output, ok = android_command_output(*MERGED_GITHUB_PRS_COMMAND)

  unless ok
    UI.important("Could not query merged GitHub PRs with gh: #{output.strip}")
    return nil
  end

  output
end

def merged_github_prs
  output = merged_github_prs_output
  return nil if output.nil?

  pull_requests = JSON.parse(output)
  return pull_requests if pull_requests.is_a?(Array)

  UI.important('Could not parse merged GitHub PRs from gh: expected an array.')
  nil
rescue JSON::ParserError => e
  UI.important("Could not parse merged GitHub PRs from gh: #{e.message}")
  nil
end

def github_prs_merged_on_date(pull_requests, date)
  pull_requests.select { |pull_request| android_pr_merged_on_date?(pull_request, date) }
end

def latest_android_release_pr(pull_requests)
  pull_requests.max_by { |pull_request| android_pr_merged_at(pull_request) }
end

def latest_android_release_pr_from_github(date)
  return nil unless android_command_available?('gh')

  pull_requests = merged_github_prs
  return nil if pull_requests.nil?

  latest_pr = latest_android_release_pr(github_prs_merged_on_date(pull_requests, date))
  return nil if latest_pr.nil?

  UI.message("Using PR ##{latest_pr.fetch('number')} merged at #{latest_pr.fetch('mergedAt')}.")
  positive_android_integer(latest_pr.fetch('number'), 'GitHub merged PR number')
rescue StandardError => e
  UI.important("Could not parse merged GitHub PRs from gh: #{e.message}")
  nil
end

def git_pr_log_command_for_date(date)
  [
    'git',
    'log',
    "--since=#{date.iso8601} 00:00",
    "--until=#{(date + 1).iso8601} 00:00",
    '--format=%ct%x00%s'
  ]
end

def git_pr_log_lines_for_date(date)
  output, ok = android_command_output(*git_pr_log_command_for_date(date))

  unless ok
    UI.important("Could not query local git history for merged PRs: #{output.strip}")
    return nil
  end

  output.lines
end

def git_pr_log_entry(line)
  timestamp, subject = line.chomp.split("\0", 2)
  match = subject&.match(ANDROID_RELEASE_PR_PATTERN)
  return nil if match.nil?

  [timestamp.to_i, match[:number].to_i]
end

def latest_android_release_pr_from_git(date)
  lines = git_pr_log_lines_for_date(date)
  return nil if lines.nil?

  latest_entry = lines.filter_map { |line| git_pr_log_entry(line) }.max_by(&:first)
  latest_entry&.last
end

def discovered_android_release_pr_number(date)
  latest_android_release_pr_from_github(date) || latest_android_release_pr_from_git(date)
end

def android_release_pr_number(options)
  configured_pr_number = configured_android_release_pr_number(options)
  return configured_pr_number unless configured_pr_number.nil?

  date = android_release_date(options)
  discovered_pr_number = discovered_android_release_pr_number(date)
  return discovered_pr_number unless discovered_pr_number.nil?

  UI.user_error!(
    "Could not find a PR merged on #{date}. " \
    'Set ANDROID_RELEASE_PR_NUMBER or pass merged_pr_number:<number>.'
  )
end

def google_play_version_guard_skipped?(options)
  lane_boolean_option(options, :skip_google_play_version_guard, 'SKIP_GOOGLE_PLAY_VERSION_GUARD', false)
end

def google_play_version_guard_configured?
  if google_play_configured?
    true
  else
    UI.important('Google Play credentials not found; using merged PR number without Play version-code guard.')
    false
  end
end

def log_google_play_build_number(build_number, google_tracks)
  UI.message("Google Play latest build number: #{build_number || 'none'} (tracks #{google_tracks.join(', ')})")
end

def google_play_version_guard_available?(options)
  if google_play_version_guard_skipped?(options)
    UI.important('Skipping Google Play version-code guard as requested.')
    return false
  end

  google_play_version_guard_configured?
end

def latest_google_play_build_number_for_android_release(options)
  return nil unless google_play_version_guard_available?(options)

  google_tracks = google_play_tracks(options)
  _version_codes_by_track, build_number = latest_google_play_build_number(google_tracks)
  log_google_play_build_number(build_number, google_tracks)

  build_number
rescue StandardError => e
  UI.user_error!("Failed to verify Google Play build number: #{e.message}")
end

def android_release_build_hash(build_number, google_play_build_number, merged_pr_number)
  {
    build_number: build_number,
    google_play_latest_build_number: google_play_build_number,
    merged_pr_number: merged_pr_number
  }
end

def automatic_android_release_build_hash(options)
  merged_pr_number = android_release_pr_number(options)
  google_play_build_number = latest_google_play_build_number_for_android_release(options)
  google_play_next_build_number = google_play_build_number.nil? ? nil : google_play_build_number + 1
  build_number = [merged_pr_number, google_play_next_build_number].compact.max

  android_release_build_hash(build_number, google_play_build_number, merged_pr_number)
end

def require_next_google_play_build_number_lookup!(options)
  UI.user_error!('next_google_play requires Google Play version lookup.') if google_play_version_guard_skipped?(options)
  UI.user_error!('next_google_play requires Google Play credentials.') unless google_play_configured?
end

def latest_google_play_build_number_for_next_release(options)
  google_tracks = google_play_tracks(options)
  _version_codes_by_track, google_play_build_number = latest_google_play_build_number(google_tracks)
  log_google_play_build_number(google_play_build_number, google_tracks)

  google_play_build_number
end

def next_google_play_android_release_build_hash(options)
  require_next_google_play_build_number_lookup!(options)
  begin
    google_play_build_number = latest_google_play_build_number_for_next_release(options)
    build_number = (google_play_build_number || 0) + 1
    UI.message("Using next Google Play build number: #{build_number}")
    android_release_build_hash(build_number, google_play_build_number, nil)
  rescue StandardError => e
    UI.user_error!("Failed to resolve next Google Play build number: #{e.message}")
  end
end

def next_android_release_build_number(options)
  explicit_build_number = explicit_android_release_build_number(options)
  next_google_play_requested = next_google_play_build_number_requested?(options)

  if !explicit_build_number.nil? && next_google_play_requested
    UI.user_error!('Use either build_number/version_code or next_google_play:true, not both.')
  end

  return android_release_build_hash(explicit_build_number, nil, nil) unless explicit_build_number.nil?
  return next_google_play_android_release_build_hash(options) if next_google_play_requested

  automatic_android_release_build_hash(options)
end

def require_android_release_signing!
  unless File.file?(ANDROID_RELEASE_KEYSTORE_PATH)
    UI.user_error!("Android release keystore does not exist: #{ANDROID_RELEASE_KEYSTORE_PATH}")
  end

  missing_names = ANDROID_RELEASE_SIGNING_ENV_NAMES.select { |name| ENV.fetch(name, '').empty? }
  return if missing_names.empty?

  UI.user_error!(
    "Android release signing is not configured. Missing #{missing_names.join(', ')} " \
    "in the environment or #{NATIVE_ROOT_ENV_PATH}."
  )
end

def android_play_release_asset_paths
  RELEASE_PLAY_ASSET_PATHS.select { |path| File.file?(path) }
end

def require_android_play_release_assets!
  assets = android_play_release_asset_paths
  UI.user_error!("Android App Bundle was not created: #{RELEASE_AAB_PATH}") unless assets.include?(RELEASE_AAB_PATH)

  assets
end

def print_android_play_release_assets(assets)
  UI.success('Google Play release assets:')
  assets.each { |asset| UI.message(asset) }
end

def android_play_release_result(release_build, assets)
  {
    assets: assets,
    build_number: release_build.fetch(:build_number),
    google_play_latest_build_number: release_build.fetch(:google_play_latest_build_number),
    merged_pr_number: release_build.fetch(:merged_pr_number)
  }
end

platform :android do
  desc 'Build debug APK'
  lane :build_debug do
    sh('bun run build')
    sh('bun run cap:sync:debug android')
    run_android_gradle('assembleDebug')
  end

  desc 'Build release APK'
  lane :build_release do
    sh('bun run build')
    sh("bun run #{NATIVE_CAPACITOR_SYNC_SCRIPT} android")
    ensure_release_capacitor_sync!
    run_android_gradle("assemble#{ANDROID_BUILD_VARIANT_TASK}")
  end

  desc 'Build signed Android App Bundle and upload companion assets for Google Play'
  lane :build_google_play_release do |options|
    load_android_release_secrets_env
    ensure_revenuecat_store_key!(
      'VITE_REVENUECAT_ANDROID_API_KEY',
      'goog_',
      native_release_disallowed_store_key('VITE_REVENUECAT_ANDROID_API_KEY'),
      comparison_required: NATIVE_RELEASE_TIER == 'staging',
      release_tier: NATIVE_RELEASE_TIER
    )
    release_build = next_android_release_build_number(options)
    require_android_release_signing!
    sh('bun run build')
    sh("bun run #{NATIVE_CAPACITOR_SYNC_SCRIPT} android")
    ensure_release_capacitor_sync!
    generate_capacitor_image_assets!(ANDROID_BUILD_IMAGES_SCRIPT)
    run_android_gradle(
      "bundle#{ANDROID_BUILD_VARIANT_TASK}",
      "-P#{ANDROID_RELEASE_VERSION_CODE_PROPERTY}=#{release_build.fetch(:build_number)}"
    )
    assets = require_android_play_release_assets!
    print_android_play_release_assets(assets)
    android_play_release_result(release_build, assets)
  end

  desc 'Install debug APK on a connected Android device'
  lane :install_debug do
    build_debug
    install_android_apk(DEBUG_APK_PATH)
  end

  desc 'Install release APK on a connected Android device'
  lane :install_release do
    build_release
    install_android_apk(RELEASE_APK_PATH)
  end

  desc 'Build and sideload an Android APK. Use build_type:release or ANDROID_BUILD_TYPE=release for release.'
  lane :sideload do |options|
    build_type = options[:build_type] || ENV.fetch('ANDROID_BUILD_TYPE', 'debug')

    case build_type.downcase
    when 'debug'
      install_debug
    when 'release'
      install_release
    else
      UI.user_error!("Unknown Android build type: #{build_type}. Expected debug or release.")
    end
  end

  desc 'Run Android unit tests'
  lane :test do
    run_android_gradle('test')
  end

  desc 'Clean Android build artifacts'
  lane :clean do
    run_android_gradle('clean')
  end
end

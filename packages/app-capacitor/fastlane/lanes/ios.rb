# frozen_string_literal: true

require 'shellwords'
require_relative '../lib/ios_signing_keychain'
require_relative '../lib/native_release_target'

IOS_PACKAGE_DIR = File.expand_path('../..', __dir__)
IOS_DIR = File.expand_path('../../ios', __dir__)
IOS_APP_DIR = File.join(IOS_DIR, 'App')
IOS_PROJECT_PATH = File.join(IOS_APP_DIR, 'App.xcodeproj')
IOS_TARGET = 'App'
IOS_SCHEME = NATIVE_RELEASE_TARGET.fetch(:ios_scheme)
IOS_CONFIGURATION = NATIVE_RELEASE_TARGET.fetch(:ios_configuration)
IOS_OUTPUT_DIR = File.join(IOS_APP_DIR, NATIVE_RELEASE_TARGET.fetch(:ios_output_directory))
IOS_IPA_NAME = NATIVE_RELEASE_TARGET.fetch(:ios_ipa_name)
IOS_ARCHIVE_PATH = File.join(IOS_APP_DIR, native_release_ios_archive_relative_path)
IOS_CAPACITOR_CONFIG_PATH = File.join(IOS_APP_DIR, 'App/capacitor.config.json')
IOS_BUILD_IMAGES_SCRIPT = File.join(IOS_PACKAGE_DIR, 'scripts/buildIosImages.sh')
IOS_SIGNING_KEYCHAIN_OPTIONS = {
  add_to_search_list: true,
  default_keychain: true,
  lock_when_sleeps: true,
  require_create: true,
  timeout: 0,
  unlock: true
}.freeze
def load_ios_release_secrets_env
  load_native_release_secrets_env
end

def create_ios_signing_keychain(name, password)
  create_keychain(name: name, password: password, **IOS_SIGNING_KEYCHAIN_OPTIONS)
end

def with_ios_signing_keychain(&)
  setup = method(:create_ios_signing_keychain)
  cleanup = proc { |name| delete_keychain(name: name) if ios_signing_keychain_exists?(name) }
  IosSigningKeychain.with_temporary(environment: ENV, setup: setup, cleanup: cleanup, &)
end

def ios_signing_keychain_exists?(keychain_name)
  base_path = File.join(Dir.home, 'Library', 'Keychains', keychain_name)
  ["#{base_path}-db", "#{base_path}.keychain-db", base_path, "#{base_path}.keychain"].any? { |path| File.file?(path) }
end

def explicit_ios_release_build_number(options)
  value = lane_option(options, :build_number, 'IOS_BUILD_NUMBER')
  value ||= lane_option(options, :apple_build_number, 'APPLE_BUILD_NUMBER')
  return nil if value.nil?

  positive_release_integer(value, 'iOS release build number')
end

def next_testflight_build_number_requested?(options)
  lane_boolean_option(options, :next_testflight, 'IOS_RELEASE_NEXT_TESTFLIGHT', false)
end

def explicit_ios_release_version(options)
  lane_option(options, :version, 'IOS_VERSION') ||
    lane_option(options, :apple_version, 'APP_STORE_VERSION')
end

def ios_release_version(options)
  explicit_version = explicit_ios_release_version(options)
  return explicit_version unless explicit_version.nil?

  get_version_number(
    xcodeproj: IOS_PROJECT_PATH,
    target: IOS_TARGET,
    configuration: IOS_CONFIGURATION
  )
end

def testflight_version_guard_skipped?(options)
  lane_boolean_option(options, :skip_testflight_version_guard, 'SKIP_TESTFLIGHT_VERSION_GUARD', false)
end

def testflight_version_guard_configured?
  if app_store_configured?
    true
  else
    UI.important(
      'App Store Connect credentials not found; using merged PR number without TestFlight build-number guard.'
    )
    false
  end
end

def testflight_version_guard_available?(options)
  if testflight_version_guard_skipped?(options)
    UI.important('Skipping TestFlight build-number guard as requested.')
    return false
  end

  testflight_version_guard_configured?
end

def normalized_ios_testflight_build_number(build_number)
  number = build_number.to_i
  number.positive? ? number : nil
end

def log_ios_testflight_build_number(build_number, version)
  UI.message("TestFlight latest build number: #{build_number || 'none'} (version #{version})")
end

def fetch_ios_testflight_build_number(version)
  latest_testflight_build_number(
    app_identifier: NATIVE_APP_IDENTIFIER,
    api_key: app_store_connect_key_for_store_build_numbers,
    version: version,
    initial_build_number: 0
  )
end

def latest_testflight_build_number_for_ios_release(options, version)
  return nil unless testflight_version_guard_available?(options)

  build_number = fetch_ios_testflight_build_number(version)
  normalized_build_number = normalized_ios_testflight_build_number(build_number)
  log_ios_testflight_build_number(normalized_build_number, version)
  normalized_build_number
rescue StandardError => e
  UI.user_error!("Failed to verify TestFlight build number: #{e.message}")
end

def ios_release_build_hash(build_number, testflight_build_number, merged_pr_number, version)
  {
    build_number: build_number,
    merged_pr_number: merged_pr_number,
    testflight_latest_build_number: testflight_build_number,
    version: version
  }
end

def automatic_ios_release_build_hash(options, version)
  merged_pr_number = merged_release_pr_number(options, 'IOS')
  testflight_build_number = latest_testflight_build_number_for_ios_release(options, version)
  testflight_next_build_number = testflight_build_number.nil? ? nil : testflight_build_number + 1
  build_number = [merged_pr_number, testflight_next_build_number].compact.max

  ios_release_build_hash(build_number, testflight_build_number, merged_pr_number, version)
end

def require_next_testflight_build_number_lookup!(options)
  UI.user_error!('next_testflight requires TestFlight version lookup.') if testflight_version_guard_skipped?(options)
  UI.user_error!('next_testflight requires App Store Connect credentials.') unless app_store_configured?
end

def next_testflight_ios_release_build_hash(options, version)
  require_next_testflight_build_number_lookup!(options)
  testflight_build_number = latest_testflight_build_number_for_ios_release(options, version)
  build_number = (testflight_build_number || 0) + 1
  UI.message("Using next TestFlight build number: #{build_number}")

  ios_release_build_hash(build_number, testflight_build_number, nil, version)
rescue StandardError => e
  UI.user_error!("Failed to resolve next TestFlight build number: #{e.message}")
end

def next_ios_release_build_number(options)
  version = ios_release_version(options)
  explicit_build_number = explicit_ios_release_build_number(options)
  next_testflight_requested = next_testflight_build_number_requested?(options)

  if !explicit_build_number.nil? && next_testflight_requested
    UI.user_error!('Use either build_number/apple_build_number or next_testflight:true, not both.')
  end

  return ios_release_build_hash(explicit_build_number, nil, nil, version) unless explicit_build_number.nil?
  return next_testflight_ios_release_build_hash(options, version) if next_testflight_requested

  automatic_ios_release_build_hash(options, version)
end

# Resolve the signing team from the first source that is set. The iOS-specific
# names come first; TEAM_ID is last because it is generic enough to collide with
# unrelated tooling in a shared shell, but it is the name .secrets/root.env ships.
def ios_team_id(options)
  lane_option(options, :team_id, 'IOS_TEAM_ID') ||
    lane_option(options, :apple_team_id, 'APPLE_TEAM_ID') ||
    lane_option(options, :development_team, 'DEVELOPMENT_TEAM') ||
    lane_option(options, :fastlane_team_id, 'FASTLANE_TEAM_ID') ||
    lane_option(options, :root_team_id, 'TEAM_ID')
end

def require_ios_team_id!(options)
  team_id = ios_team_id(options)
  return team_id unless team_id.nil?

  UI.user_error!(
    'iOS release signing requires IOS_TEAM_ID, APPLE_TEAM_ID, DEVELOPMENT_TEAM, ' \
    'FASTLANE_TEAM_ID, TEAM_ID, or the team_id:<id> Fastlane option.'
  )
end

def ios_xcodebuild_setting(name, value)
  "#{name}=#{Shellwords.escape(value.to_s)}"
end

def active_match_keychain_path
  keychain_name = ENV['MATCH_KEYCHAIN_NAME'].to_s
  return nil if keychain_name.empty?

  FastlaneCore::Helper.keychain_path(keychain_name)
end

def ios_build_xcargs(release_build, team_id)
  settings = [
    ios_xcodebuild_setting('CURRENT_PROJECT_VERSION', release_build.fetch(:build_number)),
    ios_xcodebuild_setting('MARKETING_VERSION', release_build.fetch(:version)),
    ios_xcodebuild_setting('DEVELOPMENT_TEAM', team_id)
  ]
  keychain_path = active_match_keychain_path
  unless keychain_path.nil?
    settings << ios_xcodebuild_setting('OTHER_CODE_SIGN_FLAGS', "--keychain #{keychain_path.dump}")
  end
  settings.join(' ')
end

# Pin manual App Store signing on the App target's Release configuration only.
# The profile must not be forced globally via xcargs: that leaks onto the Swift
# Package Manager dependency targets (ZIPFoundation, RevenueCat, ...), which do
# not support provisioning profiles and fail the archive. Scoping to the App
# target leaves those library targets on their default signing.
def configure_ios_manual_signing!(profile_name, team_id)
  update_code_signing_settings(
    path: IOS_PROJECT_PATH,
    use_automatic_signing: false,
    team_id: team_id,
    code_sign_identity: 'Apple Distribution',
    profile_name: profile_name,
    targets: [IOS_TARGET],
    build_configurations: [IOS_CONFIGURATION]
  )
end

# Install the App Store distribution certificate and provisioning profile from
# the match git repo. readonly: true so it only fetches existing assets and
# never creates or mutates portal state (the App Store Connect API key is a
# Developer-role key without cloud-signing permission). Returns the installed
# profile name to pin manual signing to.
def install_ios_appstore_signing_assets!
  match(
    type: 'appstore',
    app_identifier: NATIVE_APP_IDENTIFIER,
    readonly: true
  )
  ENV.fetch(
    "sigh_#{NATIVE_APP_IDENTIFIER}_appstore_profile-name",
    "match AppStore #{NATIVE_APP_IDENTIFIER}"
  )
end

def ios_export_options(team_id, profile_name)
  {
    manageAppVersionAndBuildNumber: false,
    method: 'app-store',
    provisioningProfiles: { NATIVE_APP_IDENTIFIER => profile_name },
    signingStyle: 'manual',
    teamID: team_id,
    uploadSymbols: true
  }
end

def ensure_release_ios_capacitor_sync!
  ensure_bundled_release_capacitor_config!(
    IOS_CAPACITOR_CONFIG_PATH,
    'iOS',
    "bun run #{NATIVE_CAPACITOR_SYNC_SCRIPT} ios"
  )
end

def ios_testflight_asset_paths(ipa_path)
  [
    ipa_path,
    lane_context[SharedValues::DSYM_OUTPUT_PATH]
  ].compact.select { |path| File.file?(path) }
end

def require_ios_testflight_assets!(ipa_path)
  assets = ios_testflight_asset_paths(ipa_path)
  UI.user_error!("iOS IPA was not created: #{ipa_path}") unless assets.include?(ipa_path)

  assets
end

def print_ios_testflight_assets(assets)
  UI.success('TestFlight release assets:')
  assets.each { |asset| UI.message(asset) }
end

def ios_testflight_release_result(release_build, ipa_path, assets)
  {
    assets: assets,
    build_number: release_build.fetch(:build_number),
    ipa: ipa_path,
    merged_pr_number: release_build.fetch(:merged_pr_number),
    testflight_latest_build_number: release_build.fetch(:testflight_latest_build_number),
    version: release_build.fetch(:version)
  }
end

platform :ios do
  desc 'Install the App Store distribution cert and provisioning profile via match'
  lane :fetch_appstore_profile do
    load_ios_release_secrets_env
    profile_name = install_ios_appstore_signing_assets!
    UI.success("Installed App Store provisioning profile: #{profile_name}")
    profile_name
  end

  desc 'Build signed iOS IPA for TestFlight'
  lane :build_testflight_release do |options|
    load_ios_release_secrets_env
    ensure_revenuecat_store_key!(
      'VITE_REVENUECAT_IOS_API_KEY',
      'appl_',
      production_value: native_release_production_store_key('VITE_REVENUECAT_IOS_API_KEY'),
      release_tier: NATIVE_RELEASE_TIER
    )
    release_build = next_ios_release_build_number(options)
    team_id = require_ios_team_id!(options)
    Dir.chdir(IOS_PACKAGE_DIR) do
      sh('bun run build')
      sh("bun run #{NATIVE_CAPACITOR_SYNC_SCRIPT} ios")
    end
    ensure_release_ios_capacitor_sync!
    generate_capacitor_image_assets!(IOS_BUILD_IMAGES_SCRIPT)
    ipa_path = with_ios_signing_keychain do
      profile_name = install_ios_appstore_signing_assets!
      pbxproj_path = File.join(IOS_PROJECT_PATH, 'project.pbxproj')
      original_pbxproj = File.read(pbxproj_path)
      begin
        configure_ios_manual_signing!(profile_name, team_id)
        ipa_path = build_app(
          archive_path: IOS_ARCHIVE_PATH,
          clean: true,
          configuration: IOS_CONFIGURATION,
          export_method: 'app-store',
          export_options: ios_export_options(team_id, profile_name),
          include_symbols: true,
          output_directory: IOS_OUTPUT_DIR,
          output_name: IOS_IPA_NAME,
          project: IOS_PROJECT_PATH,
          scheme: IOS_SCHEME,
          xcargs: ios_build_xcargs(release_build, team_id)
        )
      ensure
        File.write(pbxproj_path, original_pbxproj)
      end
    end
    assets = require_ios_testflight_assets!(ipa_path)
    print_ios_testflight_assets(assets)
    ios_testflight_release_result(release_build, ipa_path, assets)
  end
end

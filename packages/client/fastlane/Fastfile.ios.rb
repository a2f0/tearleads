require 'json'
import 'utils.rb'

APP_ID = CredentialsManager::AppfileConfig.try_fetch_value(:app_identifier)
APPSTORE_PROFILE_NAME = "match AppStore #{APP_ID}"

platform :ios do
  desc 'Build debug iOS app'
  lane :build_debug do
    build_app(
      workspace: './ios/App/App.xcworkspace',
      scheme: 'App',
      configuration: 'Debug',
      export_method: 'development',
      skip_codesigning: true,
      skip_archive: true,
      destination: 'generic/platform=iOS Simulator',
      derived_data_path: './build/DerivedData'
    )
  end

  desc 'Build release iOS app'
  lane :build_release do
    UI.user_error!('Please set TEAM_ID environment variable') unless ENV['TEAM_ID']

    update_code_signing_settings(
      use_automatic_signing: false,
      path: './ios/App/App.xcodeproj',
      team_id: ENV['TEAM_ID'],
      bundle_identifier: APP_ID,
      profile_name: APPSTORE_PROFILE_NAME,
      code_sign_identity: 'Apple Distribution'
    )

    build_app(
      workspace: './ios/App/App.xcworkspace',
      scheme: 'App',
      configuration: 'Release',
      export_method: 'app-store',
      output_directory: './build',
      output_name: 'Rapid.ipa',
      xcodebuild_formatter: '',
      export_options: {
        provisioningProfiles: {
          APP_ID => APPSTORE_PROFILE_NAME
        }
      }
    )
  end

  desc 'Run iOS tests'
  lane :test do |options|
    run_tests(
      workspace: './ios/App/App.xcworkspace',
      scheme: 'App',
      devices: options[:devices] || ['iPhone 15'],
      clean: true
    )
  end

  desc 'Setup CI environment'
  lane :setup_ci_environment do
    setup_ci if ENV['CI']
  end

  private_lane :ensure_app_store_connect_api do
    UI.user_error!('Please set APP_STORE_CONNECT_KEY_ID environment variable') unless ENV['APP_STORE_CONNECT_KEY_ID']
    UI.user_error!('Please set APP_STORE_CONNECT_ISSUER_ID environment variable') unless ENV['APP_STORE_CONNECT_ISSUER_ID']

    app_store_connect_api_key(
      key_id: ENV['APP_STORE_CONNECT_KEY_ID'],
      issuer_id: ENV['APP_STORE_CONNECT_ISSUER_ID'],
      key_filepath: File.expand_path("../../../.secrets/AuthKey_#{ENV['APP_STORE_CONNECT_KEY_ID']}.p8", __dir__),
      in_house: false
    )
  end

  desc 'Build for TestFlight (sync certs, build release)'
  lane :build_for_testflight do
    UI.user_error!('Please set TEAM_ID environment variable') unless ENV['TEAM_ID']
    UI.user_error!('Please set MATCH_GIT_URL environment variable') unless ENV['MATCH_GIT_URL']
    UI.user_error!('Please set MATCH_PASSWORD environment variable') unless ENV['MATCH_PASSWORD']

    setup_ci_environment
    ensure_app_store_connect_api

    sync_certs
    build_release
  end

  desc 'Upload to TestFlight'
  lane :upload_testflight do
    ensure_app_store_connect_api

    upload_to_testflight(
      skip_waiting_for_build_processing: true,
      ipa: './build/Rapid.ipa',
      changelog: generate_release_notes('ios')
    )
  end

  desc 'Promote TestFlight build to App Store'
  lane :promote_to_production do
    deliver(
      skip_binary_upload: true,
      skip_screenshots: true,
      skip_metadata: true,
      submit_for_review: true,
      automatic_release: false
    )
  end

  desc 'Sync certificates and provisioning profiles'
  lane :sync_certs do
    match(type: 'development')
    match(type: 'appstore')
  end

  desc 'Register new device'
  lane :add_device do |options|
    UI.user_error!('Please provide device name using `name:`') unless options[:name]
    UI.user_error!('Please provide device UDID using `udid:`') unless options[:udid]

    register_devices(
      devices: {
        options[:name] => options[:udid]
      }
    )
    match(type: 'development', force_for_new_devices: true)
  end

  desc 'Increment build number'
  lane :bump_build do
    increment_build_number(
      xcodeproj: './ios/App/App.xcodeproj'
    )
  end

  desc 'Get latest build number from TestFlight'
  lane :get_testflight_build_number do
    setup_ci_environment
    ensure_app_store_connect_api

    begin
      testflight_build_number = latest_testflight_build_number(app_identifier: APP_ID)
      UI.success("Latest TestFlight build number: #{testflight_build_number}")
      testflight_build_number
    rescue StandardError => e
      UI.user_error!("Failed to fetch TestFlight build number: #{e.message}")
    end
  end

  desc 'Sync local build number to TestFlight + 1'
  lane :sync_build_from_testflight do
    testflight_build = get_testflight_build_number.to_i
    new_build = testflight_build + 1
    increment_build_number(xcodeproj: './ios/App/App.xcodeproj', build_number: new_build)
    UI.success("Updated local build number to #{new_build}")
  end

  desc 'Check if current build number already exists in TestFlight (exits 0 if exists, 1 if new)'
  lane :build_exists_in_testflight do
    setup_ci_environment
    ensure_app_store_connect_api

    current_build_number = get_build_number(xcodeproj: './ios/App/App.xcodeproj')

    begin
      testflight_build_number = latest_testflight_build_number(app_identifier: APP_ID)

      if current_build_number.to_i <= testflight_build_number.to_i
        UI.important("Build #{current_build_number} already exists in TestFlight (latest: #{testflight_build_number}). Skipping deployment.")
      else
        UI.user_error!("Build #{current_build_number} is new (TestFlight latest: #{testflight_build_number}). Proceeding with deployment.")
      end
    rescue Fastlane::Helper::BuildNumberError => e
      UI.user_error!("Build is new or not found: #{e.message}")
    rescue StandardError => e
      UI.user_error!("Failed to fetch TestFlight build number: #{e.message}")
    end
  end

  desc 'Increment version number'
  lane :bump_version do |options|
    increment_version_number(
      xcodeproj: './ios/App/App.xcodeproj',
      bump_type: options[:type] || 'patch'
    )
  end

  desc 'Clean build artifacts'
  lane :clean do
    clear_derived_data
  end

  desc 'Run Maestro UI tests on iOS simulator'
  lane :test_maestro do
    build_debug
    simulators_output = `xcrun simctl list devices booted -j`
    devices = JSON.parse(simulators_output)['devices']
    simulator = devices.values.flatten.find { |d| d['state'] == 'Booted' }&.[]('udid')
    UI.user_error!('No iOS simulator is booted. Boot a simulator first.') if simulator.to_s.empty?

    app_path = File.expand_path('../build/DerivedData/Build/Products/Debug-iphonesimulator/App.app', __dir__)
    UI.message("Installing app on simulator: #{simulator}")
    sh("xcrun simctl uninstall #{simulator} #{APP_ID} || true")
    sh("xcrun simctl install #{simulator} '#{app_path}'")
    sh("MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_DEVICE=#{simulator} $HOME/.maestro/bin/maestro --platform ios test ../.maestro/ --output maestro-report --debug-output maestro-debug")
  end
end

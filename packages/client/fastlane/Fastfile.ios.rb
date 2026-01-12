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

  desc 'Build release iOS app for simulator (no signing required)'
  lane :build_release_simulator do
    build_app(
      workspace: './ios/App/App.xcworkspace',
      scheme: 'App',
      configuration: 'Release',
      export_method: 'development',
      skip_codesigning: true,
      skip_archive: true,
      destination: 'generic/platform=iOS Simulator',
      derived_data_path: './build/DerivedData-Release'
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
      # Required to skip "Waiting for the build to show up in the build list" phase.
      # Without this, fastlane waits for external distribution even when
      # skip_waiting_for_build_processing is true.
      distribute_external: false,
      ipa: './build/Rapid.ipa',
      changelog: generate_release_notes('ios')
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

  desc 'Clean build artifacts'
  lane :clean do
    clear_derived_data
  end

  desc 'Run Maestro UI tests on iOS simulator'
  lane :test_maestro do
    run_maestro_tests(build_type: 'debug')
  end

  desc 'Run Maestro UI tests on iOS simulator with release build'
  lane :test_maestro_release do
    run_maestro_tests(build_type: 'release')
  end

  private_lane :run_maestro_tests do |options|
    build_type = options[:build_type]

    if build_type == 'release'
      build_release_simulator
      app_path = File.expand_path('../build/DerivedData-Release/Build/Products/Release-iphonesimulator/App.app', __dir__)
      message = 'Installing release app on simulator'
    else
      build_debug
      app_path = File.expand_path('../build/DerivedData/Build/Products/Debug-iphonesimulator/App.app', __dir__)
      message = 'Installing app on simulator'
    end

    simulators_output = `xcrun simctl list devices booted -j`
    devices = JSON.parse(simulators_output)['devices']
    simulator = devices.values.flatten.find { |d| d['state'] == 'Booted' }&.[]('udid')
    UI.user_error!('No iOS simulator is booted. Boot a simulator first.') if simulator.to_s.empty?

    maestro_target = ENV.fetch('MAESTRO_FLOW_PATH', '../.maestro/')
    UI.message("#{message}: #{simulator}")
    sh("xcrun simctl uninstall #{simulator} #{APP_ID} || true")
    sh("xcrun simctl install #{simulator} '#{app_path}'")
    sh("MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_DEVICE=#{simulator} $HOME/.maestro/bin/maestro --platform ios test #{maestro_target} --output maestro-report --debug-output maestro-debug")
  end
end

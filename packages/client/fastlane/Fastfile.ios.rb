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
    build_app(
      workspace: './ios/App/App.xcworkspace',
      scheme: 'App',
      configuration: 'Release',
      export_method: 'app-store',
      output_directory: './build',
      output_name: 'Rapid.ipa'
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

  desc 'Deploy to TestFlight'
  lane :deploy_testflight do
    bump_build
    build_release
    upload_to_testflight(
      skip_waiting_for_build_processing: true
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
end

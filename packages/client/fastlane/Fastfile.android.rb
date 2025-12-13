platform :android do
  desc 'Build debug APK'
  lane :build_debug do
    run_gradle(task: 'assembleDebug')
  end

  desc 'Build release APK'
  lane :build_release do
    run_gradle(task: 'assembleRelease')
  end

  desc 'Build release AAB for Play Store'
  lane :build_aab do
    run_gradle(task: 'bundleRelease')
  end

  desc 'Increment versionCode only if current code exists in Play Store'
  lane :bump_build_if_needed do
    current_version_code = android_get_version_code(gradle_file: 'android/app/build.gradle')

    begin
      play_store_version_codes = google_play_track_version_codes(
        track: 'internal',
        json_key: ENV['GOOGLE_PLAY_JSON_KEY_FILE']
      )
      latest_play_store_code = play_store_version_codes.max || 0

      if current_version_code.to_i <= latest_play_store_code.to_i
        UI.message("Current versionCode (#{current_version_code}) already exists in Play Store (#{latest_play_store_code}). Incrementing...")
        new_version_code = latest_play_store_code.to_i + 1
        android_set_version_code(
          version_code: new_version_code,
          gradle_file: 'android/app/build.gradle'
        )
      else
        UI.message("Current versionCode (#{current_version_code}) is higher than Play Store (#{latest_play_store_code}). Skipping increment.")
      end
    rescue StandardError => e
      UI.user_error!("Failed to fetch Play Store version codes: #{e.message}")
    end
  end

  desc 'Build and deploy to Play Store internal track'
  lane :deploy_internal do
    build_aab
    upload_internal
  end

  desc 'Upload AAB to Play Store internal track (without building)'
  lane :upload_internal do
    upload_to_play_store(
      track: 'internal',
      aab: 'android/app/build/outputs/bundle/release/app-release.aab',
      skip_upload_metadata: true,
      skip_upload_images: true,
      skip_upload_screenshots: true
    )
  end

  desc 'Promote internal to beta'
  lane :promote_to_beta do
    upload_to_play_store(
      track: 'internal',
      track_promote_to: 'beta',
      skip_upload_changelogs: true
    )
  end

  desc 'Promote beta to production'
  lane :promote_to_production do
    upload_to_play_store(
      track: 'beta',
      track_promote_to: 'production',
      skip_upload_changelogs: true
    )
  end

  desc 'Run Android unit tests'
  lane :test do
    run_gradle(task: 'test')
  end

  desc 'Run Android instrumented tests (requires device/emulator)'
  lane :test_instrumented do
    run_gradle(task: 'connectedAndroidTest')
  end

  desc 'Clean build artifacts'
  lane :clean do
    run_gradle(task: 'clean')
  end

  desc 'Run Maestro UI tests on Android emulator'
  lane :test_maestro do
    build_debug
    apk_path = File.expand_path('../android/app/build/outputs/apk/debug/app-debug.apk', __dir__)
    # Find the emulator device ID
    emulator_id = `adb devices | grep emulator | head -1 | cut -f1`.strip
    UI.user_error!('No Android emulator found. Start an emulator first.') if emulator_id.empty?
    sh("adb -s #{emulator_id} uninstall #{APP_ID} || true")
    sh("adb -s #{emulator_id} install -r '#{apk_path}'")
    sh("MAESTRO_CLI_NO_ANALYTICS=1 $HOME/.maestro/bin/maestro --device #{emulator_id} test ../.maestro/ --output maestro-report --debug-output maestro-debug")
  end

  private_lane :run_gradle do |options|
    gradle(
      project_dir: './android',
      task: options[:task]
    )
  end
end

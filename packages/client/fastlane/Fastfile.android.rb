import 'utils.rb'

GRADLE_FILE = File.expand_path('../android/app/build.gradle', __dir__).freeze

def get_version_code
  content = File.read(GRADLE_FILE)
  match = content.match(/versionCode\s+(\d+)/)
  UI.user_error!("Could not find versionCode in #{GRADLE_FILE}") unless match
  match[1].to_i
end

def set_version_code(version_code)
  content = File.read(GRADLE_FILE)
  new_content = content.gsub(/versionCode\s+\d+/, "versionCode #{version_code}")
  File.write(GRADLE_FILE, new_content)
end

def get_version_name
  content = File.read(GRADLE_FILE)
  match = content.match(/versionName\s+"([^"]+)"/)
  UI.user_error!("Could not find versionName in #{GRADLE_FILE}") unless match
  match[1]
end

def set_version_name(version_name)
  content = File.read(GRADLE_FILE)
  new_content = content.gsub(/versionName\s+"[^"]+"/, "versionName \"#{version_name}\"")
  File.write(GRADLE_FILE, new_content)
end

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

  desc 'Get latest versionCode from Play Store'
  lane :get_play_store_version_code do
    begin
      play_store_version_codes = google_play_track_version_codes(
        track: 'internal',
        json_key: ENV['GOOGLE_PLAY_JSON_KEY_FILE']
      )
      latest_code = play_store_version_codes.max || 0
      UI.success("Latest Play Store versionCode: #{latest_code}")
      latest_code
    rescue StandardError => e
      UI.user_error!("Failed to fetch Play Store version codes: #{e.message}")
    end
  end

  desc 'Sync local versionCode to Play Store + 1'
  lane :sync_version_from_play_store do
    play_store_code = get_play_store_version_code.to_i
    new_code = play_store_code + 1
    set_version_code(new_code)

    # Update versionName to match (1.0.XX format)
    new_version_name = "1.0.#{new_code}"
    set_version_name(new_version_name)

    UI.success("Updated local versionCode to #{new_code}, versionName to #{new_version_name}")
  end

  desc 'Check if current versionCode already exists in Play Store (exits 0 if exists, 1 if new)'
  lane :build_exists_in_play_store do
    current_version_code = get_version_code

    begin
      play_store_version_codes = google_play_track_version_codes(
        track: 'internal',
        json_key: ENV['GOOGLE_PLAY_JSON_KEY_FILE']
      )
      latest_play_store_code = play_store_version_codes.max || 0

      if current_version_code <= latest_play_store_code
        UI.important("Build #{current_version_code} already exists in Play Store (latest: #{latest_play_store_code}). Skipping deployment.")
      else
        UI.user_error!("Build #{current_version_code} is new (Play Store latest: #{latest_play_store_code}). Proceeding with deployment.")
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
    version_code = get_version_code
    release_notes = generate_release_notes('android')

    # Create changelog file for this version
    changelog_dir = File.expand_path('../fastlane/metadata/android/en-US/changelogs', __dir__)
    FileUtils.mkdir_p(changelog_dir)
    File.write("#{changelog_dir}/#{version_code}.txt", release_notes)

    upload_to_play_store(
      track: 'internal',
      aab: File.expand_path('../android/app/build/outputs/bundle/release/app-release.aab', __dir__),
      release_status: ENV.fetch('ANDROID_RELEASE_STATUS', 'draft'),
      version_name: get_version_name,
      skip_upload_images: true,
      skip_upload_screenshots: true,
      mapping_paths: [
        File.expand_path('../android/app/build/outputs/mapping/release/mapping.txt', __dir__)
      ]
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

  desc 'Run Android instrumented tests (release build)'
  lane :test_instrumented_release do
    run_gradle(
      task: 'connectedAndroidTest',
      properties: { 'android.testBuildType' => 'release' }
    )
  end

  desc 'Clean build artifacts'
  lane :clean do
    run_gradle(task: 'clean')
  end

  desc 'Run Maestro UI tests on Android emulator'
  lane :test_maestro do
    run_maestro_tests(build_type: 'debug')
  end

  desc 'Run Maestro UI tests on Android emulator with release build'
  lane :test_maestro_release do
    run_maestro_tests(build_type: 'release')
  end

  private_lane :run_maestro_tests do |options|
    build_type = options[:build_type]
    record_video = ENV.fetch('MAESTRO_RECORD_VIDEO', '').downcase
    record_video_enabled = %w[1 true yes].include?(record_video)
    video_seconds = ENV.fetch('MAESTRO_VIDEO_SECONDS', '180').to_i
    if video_seconds <= 0 || video_seconds > 180
      UI.important('Android screenrecord max is 180 seconds; using 180.') if video_seconds > 180
      video_seconds = 180
    end

    if build_type == 'release'
      build_release
      apk_path = File.expand_path('../android/app/build/outputs/apk/release/app-release.apk', __dir__)
    else
      build_debug
      apk_path = File.expand_path('../android/app/build/outputs/apk/debug/app-debug.apk', __dir__)
    end

    debug_dir = File.expand_path('../maestro-debug', __dir__)
    maestro_dir = File.expand_path('../.maestro', __dir__)
    maestro_target = ENV.fetch('MAESTRO_FLOW_PATH', maestro_dir)

    emulator_id = `adb devices | grep emulator | head -1 | cut -f1`.strip
    UI.user_error!('No Android emulator found. Start an emulator first.') if emulator_id.empty?

    sh("adb -s #{emulator_id} uninstall #{APP_ID} || true")
    sh("adb -s #{emulator_id} install -r '#{apk_path}'")

    FileUtils.mkdir_p(debug_dir)
    sh("adb -s #{emulator_id} logcat -c || true")

    if record_video_enabled
      recording_pid = spawn("adb -s #{emulator_id} shell screenrecord --time-limit #{video_seconds} /sdcard/maestro-recording-android.mp4", [:out, :err] => '/dev/null')
      Process.detach(recording_pid)
    end

    begin
      sh("MAESTRO_CLI_NO_ANALYTICS=1 $HOME/.maestro/bin/maestro --device #{emulator_id} test '#{maestro_target}' --output '#{debug_dir}/report.xml' --debug-output '#{debug_dir}' --format junit")
      maestro_result = '0'
    rescue StandardError => e
      UI.important("Maestro tests failed: #{e.message}")
      maestro_result = '1'
    end

    # Stop recording and collect debug artifacts
    if record_video_enabled
      sh("adb -s #{emulator_id} shell pkill -SIGINT screenrecord || true")
      sh("sleep 2")
      sh("adb -s #{emulator_id} pull /sdcard/maestro-recording-android.mp4 '#{debug_dir}/test-recording-android.mp4' || true")
    end
    sh("adb -s #{emulator_id} logcat -d > '#{debug_dir}/logcat.txt' 2>&1 || true")

    UI.user_error!('Maestro tests failed') unless maestro_result == '0'
  end

  private_lane :run_gradle do |options|
    gradle(
      project_dir: './android',
      task: options[:task],
      properties: options[:properties]
    )
  end
end

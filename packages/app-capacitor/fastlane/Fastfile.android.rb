# frozen_string_literal: true

require 'json'
require 'shellwords'

ANDROID_APP_ID = 'com.tearleads.app'
ANDROID_DIR = File.expand_path('../android', __dir__)
ANDROID_ASSETS_DIR = File.join(ANDROID_DIR, 'app/src/main/assets')
DEBUG_APK_PATH = File.join(ANDROID_DIR, 'app/build/outputs/apk/debug/app-debug.apk')
RELEASE_APK_PATH = File.join(ANDROID_DIR, 'app/build/outputs/apk/release/app-release.apk')

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

def run_android_gradle(task)
  sh("#{android_gradle_command} #{Shellwords.escape(task)} -p #{Shellwords.escape(ANDROID_DIR)}")
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
  config_path = File.join(ANDROID_ASSETS_DIR, 'capacitor.config.json')
  config = JSON.parse(File.read(config_path))
  return unless config.dig('plugins', 'CapacitorHttp', 'enabled')

  UI.user_error!(
    'Release Android builds require a release Capacitor sync. Run `bun run cap:sync:release android` first.'
  )
rescue Errno::ENOENT, Errno::EACCES, JSON::ParserError => e
  UI.user_error!("Could not load #{config_path}: #{e.message}")
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
    sh('bun run cap:sync:release android')
    ensure_release_capacitor_sync!
    run_android_gradle('assembleRelease')
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

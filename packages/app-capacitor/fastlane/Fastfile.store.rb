# frozen_string_literal: true

require 'json'
require 'shellwords'
require_relative 'capacitor_release_config'
require_relative 'native_release_target'
require_relative 'revenuecat_release_key'

STORE_SECRETS_DIR = NATIVE_SECRETS_DIR
GOOGLE_PLAY_DEFAULT_JSON_KEY_PATH = File.join(NATIVE_SECRETS_DIR, 'google-play-service-account.json')
GOOGLE_PLAY_DEFAULT_TRACKS = %w[production beta alpha internal].freeze

def load_store_secrets_env
  load_native_release_secrets_env(validate_service_urls: false)
end

# Fails the build unless the native config at config_path is a fully bundled
# release config. Shared by the Android and iOS release lanes.
def ensure_bundled_release_capacitor_config!(config_path, label, sync_command)
  problem = capacitor_release_problem(JSON.parse(File.read(config_path)), NATIVE_APP_IDENTIFIER)
  return if problem.nil?

  UI.user_error!(
    "Release #{label} builds must be fully bundled, but capacitor.config.json #{problem}. " \
    "Run `#{sync_command}` first."
  )
rescue Errno::ENOENT, Errno::EACCES, JSON::ParserError => e
  UI.user_error!("Could not load #{config_path}: #{e.message}")
end

# Regenerate the native app icon and splash images from assets/logo.svg before a
# release build so the shipped assets match the source art. On iOS the AppIcon is
# a gitignored artifact the App Store upload requires (CFBundleIconName / the
# 120x120 icon); on Android it refreshes the launcher and splash raster densities.
# Shared by the iOS and Android release lanes.
def generate_capacitor_image_assets!(script_path)
  sh("sh #{Shellwords.escape(script_path)}")
end

def lane_option(options, key, env_name, default_value = nil)
  value = options[key]
  value = ENV.fetch(env_name, nil) if value.nil? || value.to_s.empty?
  return default_value if value.nil? || value.to_s.empty?

  value
end

def lane_boolean_option(options, key, env_name, default_value)
  value = lane_option(options, key, env_name, default_value)
  return value if [true, false].include?(value)

  case value.to_s.strip.downcase
  when '1', 'true', 'yes', 'y'
    true
  when '0', 'false', 'no', 'n'
    false
  else
    UI.user_error!("Invalid boolean for #{key}: #{value}. Expected true or false.")
  end
end

def google_play_json_key_path
  ENV.fetch('GOOGLE_PLAY_JSON_KEY_FILE', nil) ||
    ENV.fetch('SUPPLY_JSON_KEY', nil) ||
    GOOGLE_PLAY_DEFAULT_JSON_KEY_PATH
end

def google_play_configured?
  File.file?(google_play_json_key_path)
end

def google_play_tracks(options)
  google_track = lane_option(options, :google_track, 'GOOGLE_PLAY_TRACK')
  return [google_track] unless google_track.nil?

  google_tracks = lane_option(options, :google_tracks, 'GOOGLE_PLAY_TRACKS')
  return GOOGLE_PLAY_DEFAULT_TRACKS if google_tracks.nil?

  google_tracks.split(',').map(&:strip).reject(&:empty?)
end

def require_existing_file!(path, description)
  return path if File.file?(path)

  UI.user_error!("#{description} does not exist: #{path}")
end

def app_store_connect_key_filepath(key_id)
  ENV.fetch('APP_STORE_CONNECT_API_KEY_KEY_FILEPATH', nil) ||
    ENV.fetch('APP_STORE_CONNECT_KEY_FILEPATH', nil) ||
    File.join(STORE_SECRETS_DIR, "AuthKey_#{key_id}.p8")
end

def app_store_configured?
  key_id = ENV.fetch('APP_STORE_CONNECT_KEY_ID', nil)
  issuer_id = ENV.fetch('APP_STORE_CONNECT_ISSUER_ID', nil)
  return false if key_id.to_s.empty? || issuer_id.to_s.empty?

  File.file?(app_store_connect_key_filepath(key_id))
end

def required_env_value(name)
  value = ENV.fetch(name, nil)
  UI.user_error!("#{name} is required.") if value.to_s.empty?

  value
end

def app_store_connect_api_key_options
  key_id = required_env_value('APP_STORE_CONNECT_KEY_ID')

  {
    key_id: key_id,
    issuer_id: required_env_value('APP_STORE_CONNECT_ISSUER_ID'),
    key_filepath: require_existing_file!(
      app_store_connect_key_filepath(key_id),
      'App Store Connect API key'
    )
  }
end

def app_store_connect_key_for_store_build_numbers
  app_store_connect_api_key(app_store_connect_api_key_options)
end

def google_play_track_version_code_values(track)
  google_play_track_version_codes(
    package_name: NATIVE_APP_IDENTIFIER,
    track: track,
    json_key: require_existing_file!(google_play_json_key_path, 'Google Play JSON key')
  )
end

def google_play_version_codes_by_track(tracks)
  tracks.to_h do |track|
    [track, google_play_track_version_code_values(track)]
  end
end

def latest_google_play_build_number(tracks)
  version_codes_by_track = google_play_version_codes_by_track(tracks)
  version_codes = version_codes_by_track.values.flatten

  [version_codes_by_track, version_codes.max]
end

def latest_app_store_build_number(options)
  app_store_options = {
    app_identifier: NATIVE_APP_IDENTIFIER,
    api_key: app_store_connect_key_for_store_build_numbers,
    live: lane_boolean_option(options, :apple_live, 'APP_STORE_LIVE', true)
  }

  apple_version = lane_option(options, :apple_version, 'APP_STORE_VERSION')
  app_store_options[:version] = apple_version unless apple_version.nil?

  app_store_build_number(app_store_options)
end

def store_build_numbers_skip_requested?(options, key, env_name, label)
  return false unless lane_boolean_option(options, key, env_name, false)

  UI.message("Skipping #{label} as requested.")
  true
end

def google_play_build_numbers_hash(tracks, build_number, version_codes_by_track)
  {
    tracks: tracks,
    build_number: build_number,
    version_codes_by_track: version_codes_by_track
  }
end

def fetch_google_play_build_numbers(options)
  google_tracks = google_play_tracks(options)
  version_codes_by_track, build_number = latest_google_play_build_number(google_tracks)
  UI.message("Google Play latest build number: #{build_number || 'none'} (tracks #{google_tracks.join(', ')})")

  google_play_build_numbers_hash(google_tracks, build_number, version_codes_by_track)
rescue StandardError => e
  UI.error("Failed to fetch Google Play build number: #{e.message}")
  nil
end

def google_play_build_numbers_result(options)
  return nil if store_build_numbers_skip_requested?(options, :skip_google, 'SKIP_GOOGLE_PLAY', 'Google Play')
  return fetch_google_play_build_numbers(options) if google_play_configured?

  UI.important('Google Play credentials not found. Skipping Google Play build number fetch.')
  nil
end

def app_store_build_numbers_hash(build_number, version, options)
  {
    build_number: build_number,
    version: version,
    live: lane_boolean_option(options, :apple_live, 'APP_STORE_LIVE', true)
  }
end

def fetch_app_store_build_numbers(options)
  apple_build_number = latest_app_store_build_number(options)
  apple_version = lane_context[SharedValues::LATEST_VERSION]
  UI.message("Apple App Store latest build number: #{apple_build_number} (version #{apple_version})")

  app_store_build_numbers_hash(apple_build_number, apple_version, options)
rescue StandardError => e
  UI.error("Failed to fetch Apple App Store build number: #{e.message}")
  nil
end

def app_store_build_numbers_result(options)
  return nil if store_build_numbers_skip_requested?(options, :skip_apple, 'SKIP_APP_STORE', 'Apple App Store')
  return fetch_app_store_build_numbers(options) if app_store_configured?

  UI.important('Apple App Store credentials not found. Skipping App Store build number fetch.')
  nil
end

desc 'Fetch latest remote build numbers from Google Play and Apple App Store'
lane :store_build_numbers do |options|
  load_store_secrets_env

  results = {}
  google_result = google_play_build_numbers_result(options)
  app_store_result = app_store_build_numbers_result(options)
  results[:google_play] = google_result unless google_result.nil?
  results[:app_store] = app_store_result unless app_store_result.nil?

  results
end

# frozen_string_literal: true

def google_play_upload_track(options)
  lane_option(options, :google_track, 'GOOGLE_PLAY_TRACK', 'internal')
end

def google_play_release_status(options)
  lane_option(options, :release_status, 'GOOGLE_PLAY_RELEASE_STATUS', 'completed')
end

def google_play_validate_only?(options)
  lane_boolean_option(options, :validate_only, 'GOOGLE_PLAY_VALIDATE_ONLY', false)
end

def google_play_release_binary_upload_options(release_result)
  options = {
    package_name: NATIVE_APP_IDENTIFIER,
    json_key: require_existing_file!(google_play_json_key_path, 'Google Play JSON key'),
    aab: RELEASE_AAB_PATH
  }
  mapping_paths = release_result.fetch(:assets) - [RELEASE_AAB_PATH]
  options[:mapping_paths] = mapping_paths unless mapping_paths.empty?
  options
end

def google_play_release_content_skip_options
  {
    skip_upload_apk: true,
    skip_upload_metadata: true,
    skip_upload_changelogs: true,
    skip_upload_images: true,
    skip_upload_screenshots: true
  }
end

def upload_android_play_release_options(options, release_result)
  google_play_release_binary_upload_options(release_result).merge(
    google_play_release_content_skip_options,
    track: google_play_upload_track(options),
    release_status: google_play_release_status(options),
    validate_only: google_play_validate_only?(options)
  )
end

def record_android_release_build_number(build_number)
  UI.success("Android release build number: #{build_number}")
  output_path = ENV.fetch('ANDROID_RELEASE_BUILD_NUMBER_FILE', nil)
  return if output_path.to_s.empty?

  File.write(output_path, "#{build_number}\n")
end

def upload_android_play_release_result(options, release_result)
  {
    build_number: release_result.fetch(:build_number),
    google_play_latest_build_number: release_result.fetch(:google_play_latest_build_number),
    merged_pr_number: release_result.fetch(:merged_pr_number),
    track: google_play_upload_track(options),
    release_status: google_play_release_status(options),
    validate_only: google_play_validate_only?(options),
    assets: release_result.fetch(:assets)
  }
end

platform :android do
  desc 'Build signed Android App Bundle and upload it to Google Play'
  lane :upload_google_play_release do |options|
    release_result = build_google_play_release(options)
    upload_to_play_store(upload_android_play_release_options(options, release_result))
    record_android_release_build_number(release_result.fetch(:build_number))
    upload_android_play_release_result(options, release_result)
  end
end

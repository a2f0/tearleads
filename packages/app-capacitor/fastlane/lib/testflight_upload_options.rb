# frozen_string_literal: true

require_relative 'lane_options'

# TestFlight distribution options for `ios upload_release`. The App Store
# Connect API key and the upload itself stay in lanes/ios.rb.

def testflight_changelog(options)
  lane_option(options, :changelog, 'TESTFLIGHT_CHANGELOG')
end

# Pilot distributes a build only after processing, so external distribution
# waits by default.
def testflight_skip_waiting_for_build_processing?(options)
  lane_boolean_option(
    options,
    :skip_waiting_for_build_processing,
    'TESTFLIGHT_SKIP_WAITING_FOR_BUILD_PROCESSING',
    !testflight_distribute_external?(options)
  )
end

def testflight_skip_submission?(options)
  default_value = !testflight_distribute_external?(options)
  lane_boolean_option(options, :skip_submission, 'TESTFLIGHT_SKIP_SUBMISSION', default_value)
end

def testflight_distribute_external?(options)
  lane_boolean_option(options, :distribute_external, 'TESTFLIGHT_DISTRIBUTE_EXTERNAL', false)
end

def testflight_notify_external_testers(options)
  value = lane_option(options, :notify_external_testers, 'TESTFLIGHT_NOTIFY_EXTERNAL_TESTERS')
  return nil if value.nil?

  lane_boolean_option(options, :notify_external_testers, 'TESTFLIGHT_NOTIFY_EXTERNAL_TESTERS', false)
end

def normalized_testflight_group_values(values)
  values.map(&:to_s).map(&:strip).reject(&:empty?)
end

def parsed_testflight_group_values(raw_groups)
  return normalized_testflight_group_values(raw_groups) if raw_groups.is_a?(Array)

  normalized_testflight_group_values(raw_groups.to_s.split(','))
end

def nil_if_empty_testflight_groups(groups)
  groups.empty? ? nil : groups
end

def testflight_groups(options)
  raw_groups = lane_option(options, :groups, 'TESTFLIGHT_GROUPS')
  return nil if raw_groups.nil?

  nil_if_empty_testflight_groups(parsed_testflight_group_values(raw_groups))
end

def require_testflight_distribution_options!(options)
  return unless testflight_distribute_external?(options) && testflight_groups(options).nil?

  FastlaneCore::UI.user_error!('External TestFlight distribution requires TESTFLIGHT_GROUPS or groups:<name,name>.')
end

def add_optional_testflight_upload_options!(upload_options, options)
  changelog = testflight_changelog(options)
  groups = testflight_groups(options)
  notify_external_testers = testflight_notify_external_testers(options)
  upload_options[:changelog] = changelog unless changelog.nil?
  upload_options[:groups] = groups unless groups.nil?
  upload_options[:notify_external_testers] = notify_external_testers unless notify_external_testers.nil?

  upload_options
end

def upload_ios_testflight_release_result(options, release_result)
  release_result.merge(
    distribute_external: testflight_distribute_external?(options),
    skip_submission: testflight_skip_submission?(options),
    skip_waiting_for_build_processing: testflight_skip_waiting_for_build_processing?(options)
  )
end

def record_ios_release_build_number(build_number)
  FastlaneCore::UI.success("iOS release build number: #{build_number}")
  output_path = ENV.fetch('IOS_RELEASE_BUILD_NUMBER_FILE', nil)
  return if output_path.to_s.empty?

  File.write(output_path, "#{build_number}\n")
end

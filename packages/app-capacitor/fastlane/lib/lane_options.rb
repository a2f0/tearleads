# frozen_string_literal: true

# Lane option parsing shared by every lane. Each option has one name; its
# environment fallback lets the repository-root wrappers and CI configure a lane
# without passing options. Fastlane defines UI inside its own namespace, so plain
# Ruby loaded with require_relative reaches it as FastlaneCore::UI.

def env_option(env_name)
  value = ENV.fetch(env_name, nil)
  value.nil? || value.to_s.empty? ? nil : value
end

def lane_option(options, key, env_name, default_value = nil)
  value = options[key]
  value = env_option(env_name) if value.nil? || value.to_s.empty?
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
    FastlaneCore::UI.user_error!("Invalid boolean for #{key}: #{value}. Expected true or false.")
  end
end

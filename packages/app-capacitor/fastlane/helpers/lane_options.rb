# frozen_string_literal: true

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

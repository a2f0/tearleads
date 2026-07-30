# frozen_string_literal: true

def revenuecat_key_comparison_problem(key, disallowed_value, comparison_required, release_tier)
  other_tier = release_tier == 'staging' ? 'production' : 'staging'
  disallowed_key = disallowed_value.to_s.strip
  if comparison_required && disallowed_key.empty?
    return "cannot verify #{release_tier} isolation because the #{other_tier} key is unavailable"
  end

  keys_match = !disallowed_key.empty? && key == disallowed_key
  return nil unless keys_match

  "matches the #{other_tier} key and cannot be used for #{release_tier}"
end

def revenuecat_store_key_problem(
  value,
  expected_prefix,
  disallowed_value = nil,
  comparison_required: false,
  release_tier: 'staging'
)
  key = value.to_s.strip
  return 'is missing' if key.empty?

  valid_platform_key = key.start_with?(expected_prefix) && key.length > expected_prefix.length
  return "must start with #{expected_prefix}" unless valid_platform_key

  revenuecat_key_comparison_problem(key, disallowed_value, comparison_required, release_tier)
end

def revenuecat_store_key_error_message(env_name, problem)
  "#{env_name} #{problem}; store releases require the platform-specific RevenueCat public SDK key."
end

def ensure_revenuecat_store_key!(
  env_name,
  expected_prefix,
  disallowed_value = nil,
  comparison_required: false,
  release_tier: 'staging'
)
  problem = revenuecat_store_key_problem(
    ENV.fetch(env_name, nil),
    expected_prefix,
    disallowed_value,
    comparison_required:,
    release_tier:
  )
  return if problem.nil?

  UI.user_error!(revenuecat_store_key_error_message(env_name, problem))
end

# frozen_string_literal: true

def revenuecat_key_comparison_problem(key, disallowed_value, comparison_required)
  disallowed_key = disallowed_value.to_s.strip
  if comparison_required && disallowed_key.empty?
    return 'cannot verify staging isolation because the production key is unavailable'
  end
  return 'matches the production key and cannot be used for staging' if !disallowed_key.empty? && key == disallowed_key

  nil
end

def revenuecat_store_key_problem(value, expected_prefix, disallowed_value = nil, comparison_required: false)
  key = value.to_s.strip
  return 'is missing' if key.empty?

  valid_platform_key = key.start_with?(expected_prefix) && key.length > expected_prefix.length
  return "must start with #{expected_prefix}" unless valid_platform_key

  revenuecat_key_comparison_problem(key, disallowed_value, comparison_required)
end

def ensure_revenuecat_store_key!(env_name, expected_prefix, disallowed_value = nil, comparison_required: false)
  problem = revenuecat_store_key_problem(
    ENV.fetch(env_name, nil),
    expected_prefix,
    disallowed_value,
    comparison_required: comparison_required
  )
  return if problem.nil?

  UI.user_error!(
    "#{env_name} #{problem}; store releases require the platform-specific RevenueCat public SDK key."
  )
end

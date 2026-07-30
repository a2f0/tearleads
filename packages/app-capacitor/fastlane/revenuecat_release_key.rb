# frozen_string_literal: true

def revenuecat_store_key_problem(value, expected_prefix)
  key = value.to_s.strip
  return 'is missing' if key.empty?
  return nil if key.start_with?(expected_prefix) && key.length > expected_prefix.length

  "must start with #{expected_prefix}"
end

def ensure_revenuecat_store_key!(env_name, expected_prefix)
  problem = revenuecat_store_key_problem(ENV.fetch(env_name, nil), expected_prefix)
  return if problem.nil?

  UI.user_error!(
    "#{env_name} #{problem}; store releases require the platform-specific RevenueCat public SDK key."
  )
end

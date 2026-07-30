# frozen_string_literal: true

def missing_production_baseline_problem(release_tier)
  return 'cannot verify staging isolation because the production key is unavailable' if release_tier == 'staging'

  'cannot verify the production key because its independent baseline is unavailable'
end

def revenuecat_key_identity_problem(key, production_value, release_tier)
  return "has unknown release tier #{release_tier.inspect}" unless %w[production staging].include?(release_tier)

  production_key = production_value.to_s.strip
  return missing_production_baseline_problem(release_tier) if production_key.empty?

  keys_match = key == production_key
  return 'does not match the production key' if release_tier == 'production' && !keys_match
  return 'matches the production key and cannot be used for staging' if release_tier == 'staging' && keys_match

  nil
end

def revenuecat_store_key_problem(
  value,
  expected_prefix,
  production_value:,
  release_tier:
)
  key = value.to_s.strip
  return 'is missing' if key.empty?

  valid_platform_key = key.start_with?(expected_prefix) && key.length > expected_prefix.length
  return "must start with #{expected_prefix}" unless valid_platform_key

  revenuecat_key_identity_problem(key, production_value, release_tier)
end

def revenuecat_store_key_error_message(env_name, problem)
  "#{env_name} #{problem}; store releases require the platform-specific RevenueCat public SDK key."
end

def ensure_revenuecat_store_key!(
  env_name,
  expected_prefix,
  production_value:,
  release_tier:
)
  problem = revenuecat_store_key_problem(
    ENV.fetch(env_name, nil),
    expected_prefix,
    production_value:,
    release_tier:
  )
  return if problem.nil?

  UI.user_error!(revenuecat_store_key_error_message(env_name, problem))
end

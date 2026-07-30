# frozen_string_literal: true

require 'dotenv'

NATIVE_RELEASE_TARGETS = {
  'production' => {
    android_build_variant: 'release',
    app_identifier: 'com.tearleads.app',
    capacitor_sync_script: 'cap:sync:release',
    ios_archive_name: 'Tearleads.xcarchive',
    ios_configuration: 'Release',
    ios_ipa_name: 'Tearleads.ipa',
    ios_output_directory: 'output',
    ios_scheme: 'App'
  }.freeze,
  'staging' => {
    android_build_variant: 'staging',
    app_identifier: 'com.tearleads.app.staging',
    capacitor_sync_script: 'cap:sync:staging',
    ios_archive_name: 'Tearleads-Staging.xcarchive',
    ios_configuration: 'Release-Staging',
    ios_ipa_name: 'Tearleads-Staging.ipa',
    ios_output_directory: 'output/staging',
    ios_scheme: 'App-Staging'
  }.freeze
}.freeze

NATIVE_RELEASE_TIER = ENV.fetch('NATIVE_RELEASE_TIER', 'production').strip.downcase
NATIVE_RELEASE_TARGET = NATIVE_RELEASE_TARGETS.fetch(NATIVE_RELEASE_TIER) do
  raise "Unknown NATIVE_RELEASE_TIER=#{NATIVE_RELEASE_TIER.inspect}. Expected production or staging."
end
NATIVE_APP_IDENTIFIER = NATIVE_RELEASE_TARGET.fetch(:app_identifier)
NATIVE_CAPACITOR_SYNC_SCRIPT = NATIVE_RELEASE_TARGET.fetch(:capacitor_sync_script)
NATIVE_REPO_ROOT = File.expand_path('../../..', __dir__)
NATIVE_SECRETS_DIR = File.join(NATIVE_REPO_ROOT, '.secrets')
NATIVE_ROOT_ENV_PATH = File.join(NATIVE_SECRETS_DIR, 'root.env')
NATIVE_STAGING_ENV_PATH = File.join(NATIVE_SECRETS_DIR, 'staging.env')
NATIVE_SHARED_VITE_ENV_NAMES = %w[
  VITE_REVENUECAT_SYNC_ENTITLEMENT
].freeze
NATIVE_STAGING_ENV_NAMES = (%w[
  VITE_REVENUECAT_ANDROID_API_KEY
  VITE_REVENUECAT_IOS_API_KEY
] + NATIVE_SHARED_VITE_ENV_NAMES).freeze

def parsed_native_release_env(path)
  File.file?(path) ? Dotenv.parse(path) : {}
end

def warn_ignored_native_staging_vite_names(environment)
  ignored_names = environment.keys.select do |name|
    name.start_with?('VITE_') && !NATIVE_SHARED_VITE_ENV_NAMES.include?(name)
  end
  return if ignored_names.empty?

  warn "Ignoring root.env Vite settings for staging: #{ignored_names.sort.join(', ')}"
end

# Staging keeps signing and store credentials from root.env, but only explicitly
# shared Vite settings. Its server-oriented staging.env may contain unrelated
# deploy secrets, so import only native RevenueCat client settings.
def native_release_file_environment
  root_environment = parsed_native_release_env(NATIVE_ROOT_ENV_PATH)
  return root_environment unless NATIVE_RELEASE_TIER == 'staging'

  warn_ignored_native_staging_vite_names(root_environment)
  root_environment.delete_if do |name, _value|
    name.start_with?('VITE_') && !NATIVE_SHARED_VITE_ENV_NAMES.include?(name)
  end
  staging_environment = parsed_native_release_env(NATIVE_STAGING_ENV_PATH)
  staging_environment.select! { |name, _value| NATIVE_STAGING_ENV_NAMES.include?(name) }

  root_environment.merge(staging_environment)
end

# Load release values while preserving every variable explicitly set by the
# caller. Parsing first lets the tier-specific native allowlist override root.
def load_native_release_secrets_env
  process_environment = ENV.to_h

  native_release_file_environment.each do |name, value|
    ENV[name] = value unless process_environment.key?(name)
  end
end

# A store app must never resolve to the other tier's public key, including when
# a caller exported a dotenv file before running a release wrapper.
def native_release_disallowed_store_key(env_name)
  other_tier_env_path = if NATIVE_RELEASE_TIER == 'staging'
                          NATIVE_ROOT_ENV_PATH
                        else
                          NATIVE_STAGING_ENV_PATH
                        end

  parsed_native_release_env(other_tier_env_path)[env_name]
end
